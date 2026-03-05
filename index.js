const fs = require('fs');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const userPrefix = '@180732777492705';
const blacklistMessage = ['maen', 'main', 'epep', 'mcgg'];
const filePath = 'memory.json';

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

    if (msg.hasMedia && msg.type === 'image' && body.toLowerCase().startsWith('.s')) {
        try {
            const media = await msg.downloadMedia();
            await client.sendMessage(msg.from, media, {
                sendMediaAsSticker: true,
                stickerName: "Sylvia Sticker",
                stickerAuthor: "Sylvia AI"
            });
            return;
        } catch (err) {
            console.error("Gagal convert stiker:", err.message);
        }
    }

    if (body.includes('@all') && !blacklistMessage.some(kata => body.toLowerCase().includes(kata))) {
        return msg.reply('Penyakit tag all gila');
    }

    let prompt = "";
    if (body.startsWith(userPrefix)) {
        prompt = body.substring(userPrefix.length).trim();
    } else if (body.toLowerCase().startsWith('hai sylvia')) {
        prompt = body;
    }

    if (prompt) {
        const response = await getBotResponse(prompt);
        msg.reply(response);
    }
});


const getBotResponse = async (userPrompt, userId) => {
    const filePath = 'memory.json';
    try {
        // 1. Baca Database Memori
        let allMemory = {};
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) allMemory = JSON.parse(content);
        }

        // 2. Ambil memori KHUSUS user ini, atau buat baru jika belum ada
        let userMemory = allMemory[userId] || { nama: "User", ringkasan: "Belum ada informasi khusus." };

        // 3. Request ke Sylvia dengan konteks Personal
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
        });

        const aiReply = response.data.message.content;

        updateUserMemory(userId, userMemory, userPrompt, aiReply).catch(e => console.error(e));

        return aiReply;
    } catch (error) {
        console.error('Ollama Error:', error.message);
        return "Aduh, memoriku agak konslet...";
    }
};


async function updateUserMemory(userId, oldUserMemory, prompt, reply) {
    const filePath = 'memory.json';
    
    const update = await axios.post('http://localhost:11434/api/generate', {
        model: 'Sylvia',
        prompt: `Ingatan lama user ${userId}: ${JSON.stringify(oldUserMemory)}. 
                 Chat baru: "${prompt}". Jawabanmu: "${reply}". 
                 Ekstrak informasi penting (seperti nama jika dia menyebutkan, hobi, atau fakta baru) dan gabungkan dengan ingatan lama. 
                 Berikan hasil dalam format JSON murni: {"nama": "...", "ringkasan": "..."}`,
        format: "json",
        stream: false
    });

    try {
        let allMemory = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        allMemory[userId] = JSON.parse(update.data.response);
        fs.writeFileSync(filePath, JSON.stringify(allMemory, null, 2));
    } catch (e) {
        console.error("Gagal parse update memori:", e.message);
    }
}

client.initialize();
app.listen(8000, () => console.log('Server running on port 8000'));
