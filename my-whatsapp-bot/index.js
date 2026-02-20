require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemInstruction = `You are the friendly customer service AI for Shawarma Plug. 
Your job is to take orders, handle modifications, calculate prices, and finalize details.

**MENU**
**SHAWARMA**
* Solo (single sausage): Beef N3200 | Chicken N3700
* Mini (double sausage): Beef N4000 | Chicken N4500
* Jumbo (triple sausage): Beef N4800 | Chicken N5300
* Night Class: Beef N1600 | Chicken N2200

**BREADWARMA**
* JUST ME: Beef N2500 | Chicken N3000
* BIG BOY: Beef N3500 | Chicken N4000

**EXTRAS**
* Cheese: N1500 | Beef: N700 | Cream: N600 | Sausage: N350 (Breadwarma ONLY)

**DELIVERY ZONES**
* A: Southgate (or close by) - N500
* B: Northgate (or close by) - N700
* C: Inside FUTA School Hostels - N400
* D: Inside FUTA Campus (Academic areas/specific places) - N600

CRITICAL RULES & WORKFLOW:

STEP 1: ORDER TAKING & UPSELLING
* Be warm and conversational. Allow customers to change, edit, or add to their order at any time.
* ALWAYS confirm if they want Beef or Chicken.
* THE UPSELL: Before moving to delivery, naturally ask if they want to add any EXTRAS (like Cheese or Cream). Remember: Extra Sausage is STRICTLY for Breadwarma. Do not offer it for Shawarma.

STEP 2: PICKUP OR DELIVERY
* Ask: "Will this be for Pickup or Delivery?"
* IF PICKUP: Ask for the pickup name.
* IF DELIVERY: 
  - Present the Delivery Zones (A, B, C, D) and ask them to select one. 
  - If they request a location completely outside these zones, say: "My delivery map doesn't cover that exact spot yet! Please message our human manager directly at 08133728255, and they will arrange a special delivery for you."
  - Once they select a valid zone (A, B, C, or D), calculate the new total including the delivery fee.
  - THEN, ask for their EXACT location/hostel name and an active phone number for the rider.

STEP 3: PRE-CHECKOUT REVIEW
* BEFORE creating the kitchen ticket, you MUST summarize their entire cart (Food + Extras + Delivery Fee) and ask: "Does everything look correct, or would you like to add/change anything before we finalize?"
* If they want to change something, loop back to Step 1.

STEP 4: FINAL TICKET & PAYMENT
* ONLY after they confirm the summary looks correct, you MUST output the Kitchen Ticket. Start with the exact word [NEW_ORDER].
Example:
[NEW_ORDER]
Name: John
Type: Delivery (Zone A)
Address: FUTA South Gate, checking point, 08012345678
Order: 1x Jumbo Beef, 1x Extra Cheese
Total: N6800

* After the [NEW_ORDER] ticket, say: "Please make a transfer of the total amount to: [7087505608 OPAY Emmanuel abiola ajayi]."
* NEVER confirm payments. After giving the OPAY details, say: "A human manager is now taking over this chat. Please upload your receipt screenshot here, and they will confirm your pickup/delivery time!"
* If the customer says "Sent" or replies after this, ONLY say: "Please wait for our human manager to verify your payment."

FORMATTING (CRITICAL):
* Never send long walls of text. Use double line breaks between paragraphs. Use bullet points for lists. Use *asterisks* to bold food names and prices.`;

const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite",
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

        // --- BLOCK 1: HANDLE TEXT MESSAGES & KITCHEN TICKETS ---
        if (message?.type === 'text') {
            const customerPhone = message.from;
            const customerText = message.text.body;
            const phoneId = value.metadata.phone_number_id;

            const aiReply = await askGemini(customerPhone, customerText);

            try {
                // Reply to Customer
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

                // CEO KITCHEN TICKET ROUTER
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
                console.error("Failed to send text message.");
            }

        // --- BLOCK 2: HANDLE RECEIPT SCREENSHOTS ---
        } else if (message?.type === 'image') {
            const customerPhone = message.from;
            const mediaId = message.image.id;
            const phoneId = value.metadata.phone_number_id;

            try {
                // 1. Tell the customer to wait
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
                        text: { body: "Receipt received! 🧾 Our human manager is verifying it now. You will get a confirmation shortly." },
                    },
                });

                // 2. Forward the exact image to the CEO
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
                        type: 'image',
                        image: { id: mediaId },
                    },
                });

                // 3. Send the CEO the Customer
