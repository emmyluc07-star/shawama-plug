require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemInstruction = `You are the friendly customer service AI for Shawarma Plug. 
Your job is to chat with customers, answer their questions, take orders, and finalize details.

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

**BUSINESS INFO (For Answering FAQs)**
* Hours: 4:00 PM to 9:00 PM.
* Official Contact Number: 08133728255

CRITICAL RULES & WORKFLOW:

STEP 1: GENERAL CUSTOMER CARE & CHATTING
* Be warm, conversational, and helpful. 
* If a customer asks general questions (e.g., "What is a Breadwarma?", "Where are you located?", "What time do you close?"), use the info provided to answer them naturally!
* Do NOT instantly escalate to a human for simple questions or casual chatting. Handle it yourself!
* When they are ready, seamlessly transition into taking their order.

STEP 2: ORDER TAKING & UPSELLING
* ALWAYS confirm if they want Beef or Chicken.
* THE UPSELL: Ask if they want to add EXTRAS (Cheese, Cream, etc.). Remember: Extra Sausage is strictly for Breadwarma ONLY.
* IF the customer says "No" to extras or another item, DO NOT cancel the order. Simply proceed to STEP 3.

STEP 3: PICKUP OR DELIVERY
* Ask: "Will this be for Pickup or Delivery?"
* IF PICKUP: Ask for the pickup name.
* IF DELIVERY: 
  - Present the Delivery Zones (A, B, C, D) and ask them to select one. 
  - If they request a location completely outside these zones, say: "My delivery map doesn't cover that exact spot yet! Please message our human manager directly at 08133728255, and they will arrange a special delivery for you."
  - Once they select a valid zone (A, B, C, or D), calculate the new total including the delivery fee.
  - THEN, ask for their EXACT location/hostel name and an active phone number for the rider.

STEP 4: PRE-CHECKOUT REVIEW
* BEFORE creating the kitchen ticket, you MUST summarize their entire cart (Food + Extras + Delivery Fee).
* Ask ONE direct question: "Is your order complete? Reply YES to send it to the kitchen!"

STEP 5: FINAL TICKET & PAYMENT
* WHEN the customer replies YES to Step 4, you MUST output the Kitchen Ticket. Start with [NEW_ORDER] and end with [END_TICKET].
Example:
[NEW_ORDER]
Name: John
Type: Delivery (Zone A)
Address: FUTA South Gate, checking point, 08012345678
Order: 1x Jumbo Beef, 1x Extra Cheese
Total: N6800
[END_TICKET]

* After the [END_TICKET] tag, say: "Please make a transfer of the total amount to: [7087505608 OPAY Emmanuel abiola ajayi]."
* NEVER confirm payments yourself. After giving the OPAY details, you MUST say: "Please upload your receipt screenshot here! Our human manager will confirm your order and will message you directly from our official number (08133728255) with your pickup/delivery time."
* IMPORTANT MARKETING HOOK: Right at the end of this message, add: "P.S. Don't forget to save our official WhatsApp number [08133728255] to your contacts so you can view our status for mouth-watering updates and flash sales! 😋"

STEP 6: POST-PAYMENT & ADD-ONS
* If a customer texts you again AFTER they have already reached Step 5, politely ask: "Has our manager confirmed your transaction from 08133728255 yet?"
* If they reply NO: Say, "Please give them just a moment! They are checking the kitchen for you."
* If they reply YES, you may resume normal conversation.
* If they reply YES and want to ADD to their order:
  - DO NOT make them restart. Calculate the price of ONLY the newly requested items.
  - Output a special ticket starting with [ADD_ON_ORDER] and ending with [END_TICKET].
  Example:
  [ADD_ON_ORDER]
  Name: John (Add-on)
  Added: 1x Extra Sausage
  Extra to Pay: N350
  [END_TICKET]
  - Then ask them to transfer just the "Extra to Pay" amount.

STEP 7: THE SMART ESCAPE HATCH (COMPLAINTS & HUMAN REQUESTS)
* ONLY use this step if a customer has a serious complaint (e.g., dropped food, cold food, rider is late), wants a refund, OR explicitly demands to speak to a human/manager.
* You MUST output this exact tag: [HUMAN_NEEDED]
* Then say: "I am so sorry about this! I am alerting our human manager right now. They will message you directly from our official number (08133728255) to help sort this out immediately."

STEP 8: THE REBOOT APOLOGY (SERVER AMNESIA)
* Because you run on a cloud server, your memory resets if the chat is inactive for 15 minutes. 
* Use your reasoning: If a customer seems confused that you don't remember their order, mentions an ongoing order, or acts like you should know what they are talking about (even if their phrasing is weird), realize that your memory might have reset.
* DO NOT argue with them or show them the menu blindly. 
* Say: "I am so sorry! My system had a quick network refresh and I lost my memory of your cart. 🥺 Could you please tell me your order one more time so I can rush it to the kitchen?"
  
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
const ADMIN_NUMBERS = [
    '2347087505608', // You
    //'2347025812501', // Example: CEO
    // '2348098765432'  // Example: Kitchen Manager
];

// --- ORDER ID GENERATOR ---
function getOrderCode(customerPhone) {
    if (!orderCodes.has(customerPhone)) {
        const newCode = "SP-" + Math.floor(1000 + Math.random() * 9000);
        orderCodes.set(customerPhone, newCode);
    }
    return orderCodes.get(customerPhone);
}

// --- ADMIN GOD MODE STATE ---
let manualShopState = 'auto'; // Can be 'auto', 'open', or 'closed'
let pauseMessage = ""; // Holds our temporary excuse

// --- THE DIGITAL BOUNCER (WORKING HOURS) ---
function isShopOpen() {
    if (manualShopState === 'open') return true;
    if (manualShopState === 'closed') return false;

    const now = new Date();
    const nigeriaTime = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
    const currentHour = nigeriaTime.getHours();

    const openingHour = 16;
    const closingHour = 21;

    return currentHour >= openingHour && currentHour < closingHour;
}

async function askGemini(customerPhone, userQuestion) {
    try {
        let chat = activeConversations.get(customerPhone);
        if (!chat) {
            chat = primaryModel.startChat({ history: [] });
            activeConversations.set(customerPhone, chat);
        }
        const result = await chat.sendMessage(userQuestion);
        return result.response.text();

    } catch (primaryError) {
        console.warn("⚠️ Primary AI failed. Rerouting to Fallback AI...", primaryError.message);
        try {
            let chat = fallbackModel.startChat({ history: [] });
            activeConversations.set(customerPhone, chat); 
            const result = await chat.sendMessage(userQuestion);
            return result.response.text();
        } catch (fallbackError) {
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

            // --- BLOCK 0: ADMIN GOD MODE INTERCEPTOR ---
            if (ADMIN_NUMBERS.includes(customerPhone) && customerText.startsWith('/')) {
                const command = customerText.toLowerCase().trim();
                let adminReply = "";

                if (command === '/close') {
                    manualShopState = 'closed';
                    adminReply = "🛑 GOD MODE: Shop is now manually CLOSED. The bot will send the standard night message.";
                } else if (command === '/open') {
                    manualShopState = 'open';
                    adminReply = "✅ GOD MODE: Shop is now manually OPEN. The bot is taking orders again!";
                } else if (command === '/auto') {
                    manualShopState = 'auto';
                    adminReply = "⏱️ GOD MODE: Shop is back on AUTO mode. It will follow the standard schedule.";
                } else if (command === '/pause') {
                    manualShopState = 'closed'; 
                    pauseMessage = "We are running a little behind schedule today! ⏳\n\nPlease give us a few minutes and check back soon, or message our manager at 08133728255.";
                    adminReply = "⏸️ GOD MODE: Shop is PAUSED. Customers will be told we are running late!";
                } else {
                    adminReply = "❌ Unknown command. Use /open, /close, /pause, or /auto.";
                }

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
                        text: { body: adminReply },
                    },
                });
                return res.sendStatus(200); 
            }
            
            // --- NORMAL CUSTOMER FLOW ---
            if (!isShopOpen()) {
                let excuseToGive = "We are currently closed for the night! 🌙\n\nOur kitchen opens at 4:00 PM and the Shop opens at 6:00 PM tomorrow. Drop your order then and we'll get it right to you!";
                
                if (pauseMessage !== "") {
                    excuseToGive = pauseMessage;
                }

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
                        text: { body: excuseToGive },
                    },
                });
                return res.sendStatus(200); 
            }
            
            pauseMessage = "";
            
            const aiReply = await askGemini(customerPhone, customerText);

            try {
                // Reply to Customer (Hides all secret tags from their view!)
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
                        text: { body: aiReply.replace('[NEW_ORDER]', '').replace('[ADD_ON_ORDER]', '').replace('[HUMAN_NEEDED]', '').replace('[END_TICKET]', '').trim() },
                    },
                });

               // CEO TICKET ROUTER (Catches Orders AND Complaints, slices off marketing text)
                if (aiReply.includes('[NEW_ORDER]') || aiReply.includes('[ADD_ON_ORDER]') || aiReply.includes('[HUMAN_NEEDED]')) {
                    const uniqueCode = getOrderCode(customerPhone);
                    
                    // 1. Determine the alert type
                    let alertType = "🚨 KITCHEN ALERT 🚨";
                    if (aiReply.includes('[HUMAN_NEEDED]')) {
                        alertType = "🚨 MANAGER ASSISTANCE NEEDED 🚨\nTap the number below to message them immediately!";
                    }

                    // 2. Chop off the marketing fluff so the kitchen only sees the ticket!
                    let cleanAdminAlert = aiReply;
                    if (aiReply.includes('[END_TICKET]')) {
                        cleanAdminAlert = aiReply.split('[END_TICKET]')[0].trim();
                    }
                    
                    // 3. Send to all admins
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
                                    text: { body: `${alertType}\nOrder ID: ${uniqueCode}\nFrom Customer: +${customerPhone}\n\n${cleanAdminAlert}` },
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
                        text: { body: "Receipt received! 🧾 Our human manager is verifying it now and will message you shortly from 08133728255." },
                    },
                });

                const uniqueCode = getOrderCode(customerPhone); 
                
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
                                type: 'image',
                                image: { id: mediaId },
                            },
                        });

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

        // --- BLOCK 3: HANDLE VOICE NOTES (AUDIO) ---
        } else if (message?.type === 'audio') {
            const customerPhone = message.from;
            const phoneId = value.metadata.phone_number_id;

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
                        to: customerPhone,
                        text: { body: "Hey! 🎧 I'm still learning how to listen to voice notes. Could you please type your order or question out for me? ✍️" },
                    },
                });
            } catch (error) {
                console.error("Failed to process audio message.");
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
