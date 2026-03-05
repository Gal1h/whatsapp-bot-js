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

const getBotResponse = async (userPrompt) => {
    try {
        let memory = { ringkasan: "" };
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) memory = JSON.parse(content);
        }

        const response = await axios.post('http://localhost:11434/api/chat', {
            model: 'Sylvia',
            stream: false,
            messages: [
                { role: 'system', content: `Kamu adalah Sylvia. Ingatanmu: ${memory.ringkasan}` },
                { role: 'user', content: userPrompt }
            ],
        });

        const aiReply = response.data.message.content;

        updateMemory(memory.ringkasan, userPrompt, aiReply).catch(e => console.error("Memory Error:", e.message));

        return aiReply;
    } catch (error) {
        console.error('Ollama Error:', error.message);
        return "Maaf, otak aku lagi loading...";
    }
};

async function updateMemory(oldSummary, prompt, reply) {
    const update = await axios.post('http://localhost:11434/api/generate', {
        model: 'Sylvia',
        prompt: `Data lama: ${oldSummary}. Percakapan baru: User: "${prompt}", AI: "${reply}". Ringkas ingatan ini jadi 1-2 kalimat saja untuk disimpan:`,
        stream: false
    });
    const newSummary = { ringkasan: update.data.response.trim() };
    fs.writeFileSync(filePath, JSON.stringify(newSummary, null, 2));
}

client.initialize();
app.listen(8000, () => console.log('Server running on port 8000'));
