const fs = require('fs');
const express = require('express')
const axios = require('axios')
const qrcode = require('qrcode-terminal')
const { Client, LocalAuth } = require('whatsapp-web.js')

const user = '@180732777492705'
const blacklistMessage = ['maen', 'main', 'epep', 'mcgg']

const app = express()

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'Sylvia' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
})
client.on('qr', qr => { qrcode.generate(qr, { small: true }) })
client.on('authenticated', () => { console.log('scanning...') })
client.on('ready', () => { console.log('User connected...') })

client.on('message_create', async message => {
    const messageBody = message.body

    if (messageBody.includes('@all') && !blacklistMessage.some(kata => messageBody.includes(kata))) {
        message.reply('Penyakit tag all gila')
    }
    else if (messageBody.startsWith(user)) {
        message.reply(await getBotResponse(messageBody.substring(16)))
    }
    else if (messageBody.toLowerCase().startsWith('hai sylvia')) {
        message.reply(await getBotResponse(messageBody))
    }
})

client.on('message_create', async (msg) => {
    if (msg.hasMedia && msg.type === 'image') {
        try {
            const media = await msg.downloadMedia();
            if (msg.body.toLowerCase().startsWith('.s')) {
                await client.sendMessage(msg.from, media, {
                    sendMediaAsSticker: true,
                    stickerName: "Sylvia Sticker Maker",
                    stickerAuthor: msg.author
                });
            }
        } catch (err) {
            console.error("Gagal convert stiker:", err);
        }
    }
});


client.initialize()

const getBotResponse = async (userPrompt) => {
    const filePath = 'memory.json'; 

    try {
        let memory = fs.existsSync(filePath) 
            ? JSON.parse(fs.readFileSync(filePath)) 
            : { ringkasan: "" };

        const response = await axios.post('http://localhost:11434/api/chat', {
            model: 'Sylvia',
            stream: false,
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah Sylvia. Ingatanmu saat ini: ${memory.ringkasan}`
                },
                {
                    role: 'user',
                    content: userPrompt
                }
            ],
        });

        const aiReply = response.data.message.content; 

        const updateRequest = await axios.post('http://localhost:11434/api/generate', {
            model: 'Sylvia',
            prompt: `Data lama: ${memory.ringkasan}. 
                     Percakapan baru: User bilang "${userPrompt}" dan kamu jawab "${aiReply}".
                     Tuliskan ringkasan ingatan baru yang menggabungkan informasi penting di atas (maksimal 2 kalimat):`,
            stream: false
        });

        memory.ringkasan = updateRequest.data.response.trim();
        fs.writeFileSync(filePath, JSON.stringify(memory, null, 2));

        return aiReply; 
    } catch (error) {
        console.error('Error connecting to Ollama:', error.message);
        return "Maaf, sistem sedang sibuk.";
    }
}




// getBotResponse('tanggal berapa hari ini?')

app.listen(8000, () => {
    console.log('Server running on http://localhost:8000')
})
