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
* Be warm and conversational. 
* ALWAYS confirm if they want Beef or Chicken.
* THE UPSELL: Ask if they want to add EXTRAS (Cheese, Cream, etc.). Remember: Extra Sausage is strictly for Breadwarma ONLY.
* IF the customer says "No" to extras or another item, DO NOT cancel the order. Simply proceed to STEP 2.

STEP 2: PICKUP OR DELIVERY
* Ask: "Will this be for Pickup or Delivery?"
* IF PICKUP: Ask for the pickup name.
* IF DELIVERY: 
  - Present the Delivery Zones (A, B, C, D) and ask them to select one. 
  - If they request a location completely outside these zones, say: "My delivery map doesn't cover that exact spot yet! Please message our human manager directly at 08133728255, and they will arrange a special delivery for you."
  - Once they select a valid zone (A, B, C, or D), calculate the new total including the delivery fee.
  - THEN, ask for their EXACT location/hostel name and an active phone number for the rider.

STEP 3: PRE-CHECKOUT REVIEW
* BEFORE creating the kitchen ticket, you MUST summarize their entire cart (Food + Extras + Delivery Fee).
* Ask ONE direct question: "Is your order complete? Reply YES to send it to the kitchen!"
* DO NOT ask a double-barreled question like "or do you want to change anything". Keep it simple.

STEP 4: FINAL TICKET & PAYMENT
* WHEN the customer replies YES to Step 3, you MUST output the Kitchen Ticket. Start with the exact word [NEW_ORDER].
Example:
[NEW_ORDER]
Name: John
Type: Delivery (Zone A)
Address: FUTA South Gate, checking point, 08012345678
Order: 1x Jumbo Beef, 1x Extra Cheese
Total: N6800

* After the [NEW_ORDER] ticket, say: "Please make a transfer of the total amount to: [7087505608 OPAY Emmanuel abiola ajayi]."
* NEVER confirm payments. After giving the OPAY details, you MUST say: "A human manager is now taking over this chat. Please upload your receipt screenshot here, and they will confirm your pickup/delivery time!"
* IMPORTANT MARKETING HOOK: Right at the end of this message, add: "P.S. Don't forget to save our official WhatsApp number [08133728255] to your contacts so you can view our status for mouth-watering updates and flash sales! 😋"

STEP 5: POST-PAYMENT & ADD-ONS
* If a customer texts you again AFTER they have already reached Step 4, politely ask: "Has our manager confirmed your transaction from 08133728255 yet?"
* If they reply NO: Say, "Please give them just a moment! They are checking the kitchen for you."
* If they reply YES, you may resume normal conversation.
* If they reply YES and want to ADD to their order (e.g., "I want to add a Coke"):
  - DO NOT make them restart. Calculate the price of ONLY the newly requested items.
  - Output a special ticket starting exactly with [ADD_ON_ORDER].
  Example:
  [ADD_ON_ORDER]
  Name: John (Add-on)
  Added: 1x Extra Sausage
  Extra to Pay: N350
  - Then ask them to transfer just the "Extra to Pay" amount.
  
FORMATTING (CRITICAL):
* Never send long walls of text. Use double line breaks between paragraphs. Use bullet points for lists. Use *asterisks* to bold food names and prices.`;
// --- DUAL AI MODELS (PRIMARY & FALLBACK) ---
const primaryModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite",
    systemInstruction: systemInstruction 
});

const fallbackModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    systemInstruction: systemInstruction 
});

const activeConversations = new Map();
const orderCodes = new Map(); 

// --- ADMIN BROADCAST LIST ---
// Add as many numbers as you want here, separated by commas!
const ADMIN_NUMBERS = [
    '2347087505608', // You
    //'2347025812501', // Example: CEO
    // '2348098765432'  // Example: Kitchen Manager
];

// --- ORDER ID GENERATOR ---
function getOrderCode(customerPhone) {
    if (!orderCodes.has(customerPhone)) {
        // Generates a random 4-digit number (e.g., 4928) and adds SP- to the front
        const newCode = "SP-" + Math.floor(1000 + Math.random() * 9000);
        orderCodes.set(customerPhone, newCode);
    }
    return orderCodes.get(customerPhone);
}

// --- THE DIGITAL BOUNCER (WORKING HOURS) ---
// It must live OUTSIDE of askGemini so the webhook can see it!
function isShopOpen() {
    // Get current time in Nigerian Time (WAT / UTC+1)
    const now = new Date();
    const nigeriaTime = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
    const currentHour = nigeriaTime.getHours();

    // Shop opens at 16:00 (4 PM) and closes at 21:00 (9 PM)
    const openingHour = 16;
    const closingHour = 24;

    return currentHour >= openingHour && currentHour < closingHour;
}

async function askGemini(customerPhone, userQuestion) {
    try {
        // ATTEMPT 1: Try the Primary Model (2.5-Lite)
        let chat = activeConversations.get(customerPhone);
        if (!chat) {
            chat = primaryModel.startChat({ history: [] });
            activeConversations.set(customerPhone, chat);
        }
        const result = await chat.sendMessage(userQuestion);
        return result.response.text();

    } catch (primaryError) {
        console.warn("⚠️ Primary AI failed (Traffic/Error). Rerouting to Fallback AI...", primaryError.message);
        
        try {
            // ATTEMPT 2: The Primary failed, so we try the Fallback Model (1.5-Flash)
            let chat = fallbackModel.startChat({ history: [] });
            // Overwrite the broken chat history with a fresh fallback chat
            activeConversations.set(customerPhone, chat); 
            
            const result = await chat.sendMessage(userQuestion);
            return result.response.text();

        } catch (fallbackError) {
            // ATTEMPT 3: Both Google servers failed. Send the error to the customer.
            console.error("🚨 TOTAL AI CRASH:", fallbackError.message);
            return "Sorry, our automated system is currently experiencing heavy traffic. Please 🤙 call or message 08133728255, and a manager will take your order immediately!";
        }
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

            // Check if the shop is closed before waking up the AI
            if (!isShopOpen()) {
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
                        text: { body: "We are currently closed for the night! 🌙\n\nOur kitchen opens at 4:00 PM tomorrow and the Shop opens at 6:00 PM tomorrow. Drop your order then and we'll get it right to you!" },
                    },
                });
                return res.sendStatus(200); // Stop the code here!
            }
            
            // If shop is open, continue to Gemini...
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
                        text: { body: aiReply.replace('[NEW_ORDER]', '').replace('[ADD_ON_ORDER]', '').trim() },
                    },
                });

               // CEO & KITCHEN TICKET ROUTER (MULTIPLE ADMINS & ADD-ONS)
                if (aiReply.includes('[NEW_ORDER]') || aiReply.includes('[ADD_ON_ORDER]')) {
                    const uniqueCode = getOrderCode(customerPhone);
                    
                    // Loop through every admin number and send the ticket
                    for (const adminPhone of ADMIN_NUMBERS) {
                        try {
                            await axios({
                                method: 'POST',
                                url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                                headers: {
                                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                                    'Content-Type': 'application/json',
                                },
                                data: {
                                    messaging_product: 'whatsapp',
                                    to: adminPhone, 
                                    text: { body: `🚨 KITCHEN ALERT 🚨\nOrder ID: ${uniqueCode}\nFrom Customer: +${customerPhone}\n\n${aiReply}` },
                                },
                            });
                        } catch (err) {
                            console.error(`Failed to send ticket to ${adminPhone}`);
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to send text message.", error);
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

                // 2 & 3. Forward the exact image and text to ALL ADMINS
                const uniqueCode = getOrderCode(customerPhone); 
                
                for (const adminPhone of ADMIN_NUMBERS) {
                    try {
                        // Send the Image
                        await axios({
                            method: 'POST',
                            url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                            headers: {
                                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                                'Content-Type': 'application/json',
                            },
                            data: {
                                messaging_product: 'whatsapp',
                                to: adminPhone, 
                                type: 'image',
                                image: { id: mediaId },
                            },
                        });

                        // Send the Tap-to-Reply Text
                        await axios({
                            method: 'POST',
                            url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                            headers: {
                                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                                'Content-Type': 'application/json',
                            },
                            data: {
                                messaging_product: 'whatsapp',
                                to: adminPhone, 
                                text: { body: `🚨 RECEIPT ALERT 🚨\nOrder ID: ${uniqueCode}\nFrom Customer: +${customerPhone}\n\nTo approve this order, tap their number above to message them directly from your personal WhatsApp!` },
                            },
                        });
                    } catch (err) {
                        console.error(`Failed to send receipt to ${adminPhone}`);
                    }
                }
            } catch (error) {
                console.error("Failed to process image block.", error);
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
