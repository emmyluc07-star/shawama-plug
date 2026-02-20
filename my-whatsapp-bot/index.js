require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemInstruction = `You are the friendly customer service AI for Shawarma Plug. 
Your job is to take orders, calculate prices, and finalize details.

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

CRITICAL RULES:
1. Be warm and conversational. Remember what the customer just said.
2. ALWAYS confirm Beef or Chicken.
3. Once they choose their food, ask: "Will this be for Pickup or Delivery?"
4. IF PICKUP: Ask for the name for the order.
5. IF DELIVERY: You MUST ask for their exact delivery address and an active phone number for the rider.
6. **THE KITCHEN TICKET (CRITICAL):** Once you have the final food items, the total price, AND their delivery address (or pickup name), you MUST output a summary for the kitchen. Start the summary with the exact word [NEW_ORDER]. 
Example:
[NEW_ORDER]
Name: John
Type: Delivery
Address: FUTA South Gate hostel
Order: 1x Jumbo Beef, 1x Extra Cheese
Total: N6300

7. After the [NEW_ORDER] summary, tell the customer: "Please make a transfer of the total amount to: [7087505608 OPAY Emmanuel abiola ajayi]. Reply with your receipt, and our team will dispatch your meal immediately!"`;

const model = genAI.getGenerativeModel({ 
    model: "gemin-2.0-flash",
    systemInstruction: systemInstruction 
});

const activeConversations = new Map();

async function askGemini(customerPhone, userQuestion) {
    try {
        let chat = activeConversations.get(customerPhone);
        if (!chat) {
            chat = model.startChat({ history: [] });
            activeConversations.set(customerPhone, chat);
        }
        const result = await chat.sendMessage(userQuestion);
        return result.response.text();
    } catch (error) {
        console.error("🚨 GEMINI CRASH REASON:", error.message);
        return "Sorry, our system is down. Please 🤙 call or message 08133728255.  OR try resending you last message in the next 1 minute";
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

            const aiReply = await askGemini(customerPhone, customerText);

            try {
                // 1. Reply to Customer
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
                        text: { body: aiReply.replace('[NEW_ORDER]', '').trim() },
                    },
                });

                // 2. CEO KITCHEN TICKET ROUTER
                if (aiReply.includes('[NEW_ORDER]')) {
                    await axios({
                        method: 'POST',
                        url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                        headers: {
                            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                            'Content-Type': 'application/json',
                        },
                        data: {
                            messaging_product: 'whatsapp',
                            to: '2347087505608', 
                            text: { body: `🚨 KITCHEN ALERT 🚨\nFrom Customer: +${customerPhone}\n\n${aiReply}` },
                        },
                    });
                }

            } catch (error) {
                console.error("Failed to send message.");
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Bot server is running on port ${PORT}`);
});
                    
