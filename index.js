const fs = require('fs');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const userPrefix = '@180732777492705';
const blacklistMessage = ['maen', 'main', 'epep', 'mcgg'];
const path = require('path');
const filePath = path.join(__dirname, 'memory.json');

const app = express();

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'Sylvia' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('Sylvia is ready!'));

client.on('message_create', async (msg) => {
    const body = msg.body || "";

    // FIX 1: downloadMedia — tambah retry + timeout handling
    if (msg.hasMedia && msg.type === 'image' && body.toLowerCase().startsWith('.s')) {
        try {
            let media = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    media = await Promise.race([
                        msg.downloadMedia(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Download timeout')), 15000)
                        )
                    ]);
                    if (media) break;
                } catch (dlErr) {
                    console.error(`Attempt ${attempt} gagal download media:`, dlErr.message);
                    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
                }
            }

            if (!media) {
                await msg.reply('Gagal download gambar, coba kirim ulang.');
                return;
            }

            await client.sendMessage(msg.from, media, {
                sendMediaAsSticker: true,
                stickerName: "Sylvia Sticker",
                stickerAuthor: "Sylvia AI"
            });
            return;
        } catch (err) {
            console.error("Gagal convert stiker:", err.message);
            await msg.reply('Gagal bikin stiker, coba lagi.');
        }
    }

    if (body.includes('@all') && !blacklistMessage.some(kata => body.toLowerCase().includes(kata))) {
        return msg.reply('Penyakit tag all gila');
    }

    // FIX 2: userId seharusnya diambil dari msg.from, bukan undefined
    const userId = msg.from;

    let prompt = "";
    if (body.startsWith(userPrefix)) {
        prompt = body.substring(userPrefix.length).trim();
    } else if (body.toLowerCase().startsWith('hai sylvia')) {
        prompt = body;
    }

    if (prompt) {
        // FIX 3: pass userId yang benar ke getBotResponse
        const response = await getBotResponse(prompt, userId);
        msg.reply(response);
    }
});


const getBotResponse = async (userPrompt, userId) => {
    try {
        // Baca Database Memori
        let allMemory = {};
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) {
                try {
                    allMemory = JSON.parse(content);
                } catch (e) {
                    console.error('Memory file corrupt, reset:', e.message);
                    allMemory = {};
                }
            }
        }

        const userMemory = allMemory[userId] || { nama: "User", ringkasan: "Belum ada informasi khusus." };

        // FIX 4: tambah timeout untuk request Ollama
        const response = await axios.post('http://localhost:11434/api/chat', {
            model: 'Sylvia',
            stream: false,
            messages: [
                {
                    role: 'system',
                    content: `Kamu Sylvia. Kamu bicara dengan ID: ${userId}. Ingatanmu tentang dia: ${JSON.stringify(userMemory)}`
                },
                { role: 'user', content: userPrompt }
            ],
        }, {
            timeout: 60000 // 60 detik timeout
        });

        // FIX 5: validasi response sebelum akses .content
        if (!response.data || !response.data.message || !response.data.message.content) {
            console.error('Response Ollama tidak valid:', JSON.stringify(response.data));
            return "Aduh, jawaban Ollama kosong nih...";
        }

        const aiReply = response.data.message.content;

        // Update memori secara async (tidak blocking)
        updateUserMemory(userId, userMemory, userPrompt, aiReply).catch(e =>
            console.error('updateUserMemory error:', e.message)
        );

        return aiReply;
    } catch (error) {
        console.error('Error connecting to Ollama:', error.message);
        return "Aduh, memoriku agak konslet...";
    }
};


async function updateUserMemory(userId, oldUserMemory, prompt, reply) {
    try {
        // FIX 6: tambah timeout + validasi response dari /api/generate
        const update = await axios.post('http://localhost:11434/api/generate', {
            model: 'Sylvia',
            prompt: `Ingatan lama user ${userId}: ${JSON.stringify(oldUserMemory)}. 
                     Chat baru: "${prompt}". Jawabanmu: "${reply}". 
                     Ekstrak informasi penting (seperti nama jika dia menyebutkan, hobi, atau fakta baru) dan gabungkan dengan ingatan lama. 
                     Berikan hasil dalam format JSON murni tanpa markdown, tanpa komentar: {"nama": "...", "ringkasan": "..."}`,
            format: "json",
            stream: false
        }, {
            timeout: 60000
        });

        // FIX 7: validasi response.data.response sebelum di-parse
        if (!update.data || !update.data.response || !update.data.response.trim()) {
            console.error('Response update memori kosong untuk userId:', userId);
            return;
        }

        // FIX 8: bersihkan kemungkinan markdown fence dari response
        let rawJson = update.data.response.trim();
        rawJson = rawJson.replace(/```json|```/g, '').trim();

        let newMemory;
        try {
            newMemory = JSON.parse(rawJson);
        } catch (parseErr) {
            console.error('Gagal parse update memori:', parseErr.message, '| Raw:', rawJson.substring(0, 200));
            return;
        }

        // FIX 9: baca ulang file dengan validasi, hindari race condition
        let allMemory = {};
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) {
                try {
                    allMemory = JSON.parse(content);
                } catch (e) {
                    console.error('Memory file corrupt saat update, reset:', e.message);
                }
            }
        }

        allMemory[userId] = newMemory;
        fs.writeFileSync(filePath, JSON.stringify(allMemory, null, 2));
        console.log(`Memori user ${userId} berhasil diupdate.`);
    } catch (e) {
        console.error('updateUserMemory gagal:', e.message);
    }
}

client.initialize();
app.listen(8000, () => console.log('Server running on port 8000'));