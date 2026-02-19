require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// The Conversational Shawarma Plug AI
async function askGemini(userQuestion) {
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: `You are the friendly, conversational customer service assistant for Shawarma Plug. 
Your job is to take orders, calculate prices, and handle customer interactions with empathy and warmth.

Here is our menu:
**SHAWARMA**
* Solo (single sausage): Beef N3200 | Chicken N3700
* Mini (double sausage): Beef N4000 | Chicken N4500
* Jumbo (triple sausage): Beef N4800 | Chicken N5300
* Night Class: Beef N1600 | Chicken N2200

**BREADWARMA**
* JUST ME: Beef N2500 | Chicken N3000
* BIG BOY: Beef N3500 | Chicken N4000

**EXTRAS**
* Cheese: N1500 | Beef: N700 | Cream: N600 | Sausage: N350

Rules:
1. Be warm and polite. 
2. ALWAYS confirm Beef or Chicken.
3. Gently upsell extras (Cheese, Sausage).
4. Calculate total price clearly and ask pickup/delivery.
5. IF COMPLAINING OR ASKING FOR HUMAN: Apologize sincerely, say "I am flagging this for a human manager right now, they will step in shortly," and offer the number 08133728255. Do not argue.` 
        });
        const result = await model.generateContent(userQuestion);
        return result.response.text();
    } catch (error) {
        console.error("Gemini Error:", error);
        return "Sorry, our system is down. Please call 08133728255.";
    }
}

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === process.env.VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message?.type === 'text') {
            const customerPhone = message.from;
            const customerText = message.text.body;
            const phoneId = value.metadata.phone_number_id;

            const aiReply = await askGemini(customerText);

            try {
                // 1. Send reply to the customer
                await axios({
                    method: 'POST',
                    url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                    headers: {
                        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    data: {
                        messaging_product: 'whatsapp',
                        to: customerPhone,
                        text: { body: aiReply },
                    },
                });

                // 2. Send silent notification to YOUR phone (Replace with your Redmi number)
                await axios({
                    method: 'POST',
                    url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                    headers: {
                        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    data: {
                        messaging_product: 'whatsapp',
                        to: '07087505603', // <--- PUT YOUR NUMBER HERE!
                        text: { body: `🤖 BOT LOG: Handled a message from ${customerPhone}.` },
                    },
                });

            } catch (error) {
                console.error("Failed to send message.");
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Bot server is running on port ${PORT}`);
});