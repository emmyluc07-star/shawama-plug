require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(express.json());

// --- GOOGLE SHEETS DATABASE SETUP ---
// This automatically fixes the \n issue from Render!
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

async function saveOrderToDatabase(customerPhone, orderDetails, orderId) {
    try {
        await doc.loadInfo(); 
        const sheet = doc.sheetsByIndex[0]; // Grabs the very first tab
        
        // Get precise Nigerian time
        const now = new Date();
        const dateStr = now.toLocaleString("en-US", { timeZone: "Africa/Lagos" });
        
        await sheet.addRow([
            dateStr,          // A: Date
            "+" + customerPhone, // B: Phone Number
            orderDetails,     // C: Order Details
            "Pending",        // D: Total Price (Leave pending for admin confirmation)
            orderId           // E: Order ID
        ]);
        console.log(`✅ SUCCESS: Order ${orderId} saved to Google Sheets!`);
    } catch (error) {
        console.error("❌ DATABASE ERROR: Failed to save to Google Sheets:", error.message);
    }
}

// --- AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemInstruction = `You are the friendly customer service AI for Shawarma Plug. 
Your job is to chat with customers, answer their questions, take orders, and finalize details.

*MENU*
*SHAWARMA*
~ Solo (single sausage): Beef N3200 | Chicken N3700
~ Mini (double sausage): Beef N4000 | Chicken N4500
~ Jumbo (triple sausage): Beef N4800 | Chicken N5300
~ Night Class: Beef N1600 | Chicken N2200

*BREADWARMA*
~ JUST ME: Beef N2500 | Chicken N3000
~ BIG BOY: Beef N3500 | Chicken N4000

*EXTRAS*
~ Cheese: N1500 | Beef: N700 | Cream: N600 | Sausage: N350 (Breadwarma ONLY)

*DELIVERY ZONES*
(A): Southgate (or close by) - N800
(B): Northgate (or close by) - N2000
(C): Inside FUTA School Hostels - N400
(D): Inside FUTA Campus (Academic areas/specific places) - N600
(E): Other Locations (Requires custom price from Manager)

*BUSINESS INFO (For Answering FAQs)*
~ Hours: 4:00 PM to 9:00 PM.
~ Official Contact Number: 08133728255
~ Locations: 
. Aluta Market Opposite Annex 3, FUTA Campus. 
. Yeklox Complex Oppisite Embassy Junction, FUTA Southgate.
. T Junction at Westgate.

CRITICAL RULES & WORKFLOW:

STEP 1: GENERAL CUSTOMER CARE & CHATTING
* Be warm, conversational, and helpful. 
* If a customer asks general questions (e.g., "What is a Breadwarma?", "Where are you located?"), use the info provided to answer them naturally!
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
  - Present the Delivery Zones (A, B, C, D, E) and ask them to select one. 
  - If they choose A, B, C, or D: calculate the new total including the delivery fee, THEN ask for their EXACT location and active phone number for the rider.
  - IF THEY CHOOSE ZONE E:
    1. Ask for their EXACT delivery address and active phone number.
    2. Once they provide it, you MUST output this exact tag: [PRICE_REQUEST]
    3. Then say: "Please give me just a moment! I am checking with our dispatch rider to get the exact delivery fee for your location. 🛵💨"
    4. STOP. Do not proceed to Step 4 until the system updates you with the price.

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

* After the [END_TICKET] tag, say: "Please make a transfer of the total amount to: 7087505608 OPAY Emmanuel abiola ajayi."
* NEVER confirm payments yourself. After giving the OPAY details, you MUST say: "Upload your receipt screenshot here! Our human representative will confirm your order via (08133728255) and respond to you."

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
* Use your reasoning: If a customer seems confused that you don't remember their order, realize that your memory might have reset.
* DO NOT argue with them or show them the menu blindly. 
* Say: "I am so sorry! My system had a quick network refresh and I lost my memory of your cart. 🥺 Could you please tell me your order one more time so I can rush it to the kitchen?"
  
FORMATTING (CRITICAL):
* STRICT RULE: DO NOT use asterisks (*) or markdown anywhere in your response. 
* Keep formatting completely clean and plain for WhatsApp.
* Use ALL CAPS for emphasis if needed, rather than bolding.
* Never send long walls of text. Use double line breaks between paragraphs. Use dashes (-) for bullet points.
* Try not to write long texts, keep them as short as you can. Replace long paragraphs with clean, dashed lists whenever you are explaining things to a customer.`;

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
    '2348133728255'  // Kitchen Manager
];

function getOrderCode(customerPhone) {
    if (!orderCodes.has(customerPhone)) {
        const newCode = "SP-" + Math.floor(1000 + Math.random() * 9000);
        orderCodes.set(customerPhone, newCode);
    }
    return orderCodes.get(customerPhone);
}

function getPhoneByOrderCode(searchCode) {
    for (let [phone, code] of orderCodes.entries()) {
        if (code === searchCode) return phone;
    }
    return null;
}

let manualShopState = 'auto'; 
let pauseMessage = ""; 

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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function askGemini(customerPhone, userQuestion, retries = 2) {
    let chat = activeConversations.get(customerPhone);

    if (!chat) {
        chat = primaryModel.startChat({ history: [] });
        chat.activeModel = 'primary'; 
        activeConversations.set(customerPhone, chat);
    }

    try {
        const result = await chat.sendMessage(userQuestion);
        return result.response.text();

    } catch (error) {
        console.warn(`⚠️ ${chat.activeModel.toUpperCase()} AI failed. Error:`, error.message);

        if (retries > 0) {
            console.log(`⏳ Rate limit hit! Waiting 3 seconds... (${retries} retries left)`);
            await delay(3000); 
            return await askGemini(customerPhone, userQuestion, retries - 1); 
        }

        if (chat.activeModel === 'primary') {
            console.log("🔄 Retries failed. Rerouting user to Fallback AI and transferring memory...");
            
            let oldHistory = [];
            try { oldHistory = await chat.getHistory(); } catch (e) {}

            chat = fallbackModel.startChat({ history: oldHistory });
            chat.activeModel = 'fallback'; 
            activeConversations.set(customerPhone, chat);

            try {
                const result = await chat.sendMessage(userQuestion);
                return result.response.text();
            } catch (fallbackError) {
                console.error("🚨 FALLBACK AI INSTANT CRASH:", fallbackError.message);
                return "Sorry, our system is experiencing heavy traffic! Please 🤙 call or message 08133728255 to place your order.";
            }
        } else {
            console.error("🚨 TOTAL AI CRASH: Both models failed.");
            return "Sorry, our system is experiencing heavy traffic! Please 🤙 call or message 08133728255 to place your order.";
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

        if (message?.type === 'text') {
            const customerPhone = message.from;
            const customerText = message.text.body;
            const phoneId = value.metadata.phone_number_id; 

            if (ADMIN_NUMBERS.includes(customerPhone) && customerText.startsWith('/')) {
                const command = customerText.toLowerCase().trim();
                let adminReply = "";

                if (command === '/close') {
                    manualShopState = 'closed';
                    adminReply = "🛑 GOD MODE: Shop is now manually CLOSED.";
                } else if (command === '/open') {
                    manualShopState = 'open';
                    adminReply = "✅ GOD MODE: Shop is now manually OPEN.";
                } else if (command === '/auto') {
                    manualShopState = 'auto';
                    adminReply = "⏱️ GOD MODE: Shop is back on AUTO mode.";
                } else if (command === '/pause') {
                    manualShopState = 'closed'; 
                    pauseMessage = "We are running a little behind schedule today! ⏳\n\nPlease give us a few minutes and check back soon, or message our manager at 08133728255.";
                    adminReply = "⏸️ GOD MODE: Shop is PAUSED.";
                } else if (command.startsWith('/price')) {
                    const parts = command.split(' ');
                    if (parts.length >= 3) {
                        const targetOrder = parts[1].toUpperCase();
                        const priceAmount = parts[2];
                        const targetPhone = getPhoneByOrderCode(targetOrder);

                        if (targetPhone) {
                            const injectionPrompt = `[SYSTEM MESSAGE]: The manager has confirmed the delivery fee for Zone E is N${priceAmount}. Tell the customer this good news, add it to their total, and ask if their order is complete to proceed to checkout!`;
                            const aiFollowUp = await askGemini(targetPhone, injectionPrompt);

                            await axios({
                                method: 'POST',
                                url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                                headers: {
                                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                                    'Content-Type': 'application/json',
                                },
                                data: {
                                    messaging_product: 'whatsapp',
                                    to: targetPhone,
                                    text: { body: aiFollowUp.replace('[PRICE_REQUEST]', '').trim() },
                                },
                            });
                            adminReply = `✅ Done! I told the customer delivery is N${priceAmount} and resumed their chat.`;
                        } else {
                            adminReply = `❌ Error: Could not find an active chat for ${targetOrder}.`;
                        }
                    } else {
                        adminReply = `❌ Invalid format. Please use: /price SP-XXXX 500`;
                    }
                } else {
                    adminReply = "❌ Unknown command. Use /open, /close, /pause, /auto, or /price SP-XXXX AMOUNT.";
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
            
            if (!isShopOpen()) {
                let excuseToGive = "We are currently closed for the night! 🌙\n\nOur kitchen opens at 4:00 PM and the Shop opens at 6:00 PM tomorrow. Drop your order then and we'll get it right to you!";
                if (pauseMessage !== "") excuseToGive = pauseMessage;

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
                        text: { body: aiReply.replace('[NEW_ORDER]', '').replace('[ADD_ON_ORDER]', '').replace('[HUMAN_NEEDED]', '').replace('[END_TICKET]', '').replace('[PRICE_REQUEST]', '').trim() },
                    },
                });

                if (aiReply.includes('[NEW_ORDER]') || aiReply.includes('[ADD_ON_ORDER]') || aiReply.includes('[HUMAN_NEEDED]') || aiReply.includes('[PRICE_REQUEST]')) {
                    const uniqueCode = getOrderCode(customerPhone);
                    
                    let alertType = "🚨 KITCHEN ALERT 🚨";
                    if (aiReply.includes('[HUMAN_NEEDED]')) {
                        alertType = "🚨 MANAGER ASSISTANCE NEEDED 🚨\nTap the number below to message them immediately!";
                    } else if (aiReply.includes('[PRICE_REQUEST]')) {
                        alertType = `🚨 DELIVERY QUOTE NEEDED 🚨\nTo set the price, reply to me with exactly:\n/price ${uniqueCode} 500`;
                    }

                    let cleanAdminAlert = aiReply;
                    if (aiReply.includes('[END_TICKET]')) {
                        cleanAdminAlert = aiReply.split('[END_TICKET]')[0].trim();
                    }

                    // --- INJECT THE SPREADSHEET SAVER HERE! ---
                    if (aiReply.includes('[NEW_ORDER]')) {
                        saveOrderToDatabase(customerPhone, cleanAdminAlert.replace('[NEW_ORDER]', '').trim(), uniqueCode);
                    }
                    
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
                                    text: { body: `${alertType}\nOrder ID: ${uniqueCode}\nFrom Customer: +${customerPhone}\n\n${cleanAdminAlert.replace('[PRICE_REQUEST]', '').replace('[NEW_ORDER]', '')}` },
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
