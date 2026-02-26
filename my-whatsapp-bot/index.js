require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(express.json());

// --- GOOGLE SHEETS DATABASE SETUP ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

async function saveOrderToDatabase(customerPhone, orderDetails, orderId) {
    try {
        await doc.loadInfo(); 
        const sheet = doc.sheetsByIndex[0]; 
        
        const now = new Date();
        const dateStr = now.toLocaleString("en-US", { timeZone: "Africa/Lagos" });
        
        await sheet.setHeaderRow(['Date', 'Phone', 'Order', 'Status', 'OrderID']);

        await sheet.addRow({
            Date: dateStr,
            Phone: "+" + customerPhone,
            Order: orderDetails,
            Status: "⏳ Pending Payment",
            OrderID: orderId
        });
        console.log(`✅ SUCCESS: Order ${orderId} safely stored as Pending!`);
    } catch (error) {
        console.error("❌ DATABASE ERROR: Failed to save to Google Sheets:", error.message);
    }
}

async function confirmOrderInDatabase(orderId) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();

        const targetRow = rows.find(r => {
            const id = r.OrderID || (typeof r.get === 'function' && r.get('OrderID'));
            return id === orderId;
        });

        if (targetRow) {
            if (typeof targetRow.assign === 'function') {
                targetRow.assign({ Status: '✅ CONFIRMED' });
            } else if (typeof targetRow.set === 'function') {
                targetRow.set('Status', '✅ CONFIRMED');
            } else {
                targetRow.Status = '✅ CONFIRMED';
            }
            await targetRow.save();

            const phone = targetRow.Phone || (typeof targetRow.get === 'function' && targetRow.get('Phone'));
            return phone ? phone.replace('+', '') : null;
        }
        return null; 
    } catch (error) {
        console.error("❌ Update failed:", error.message);
        return null;
    }
}

// --- DYNAMIC MENU STATE & FETCHER ---
let liveMenuCache = "Menu is currently syncing...";

async function syncMenuFromDatabase() {
    try {
        await doc.loadInfo(); 
        const menuSheet = doc.sheetsByIndex[1]; // Grabs the 2nd tab (Sheet2)
        if (!menuSheet) {
            console.error("❌ MENU ERROR: Could not find Sheet2. Please create a 2nd tab for the menu.");
            return;
        }
        
        const rows = await menuSheet.getRows();
        let menuBuilder = "*LIVE MENU KNOWLEDGE BASE*\n(Use these exact prices and items. DO NOT offer items that are not on this list. If a category is empty, it means we are out of stock of everything in it.)\n\n";
        let menuCategories = {};

        // Loop through the spreadsheet and group items by Category
        rows.forEach(row => {
            const category = row.get('Category');
            const item = row.get('Item');
            const price = row.get('Price');
            const available = row.get('Available');

            // Only add the item to the AI's memory if Available is TRUE
            if (available && available.toString().toUpperCase() === 'TRUE') {
                if (!menuCategories[category]) menuCategories[category] = [];
                menuCategories[category].push(`~ ${item}: N${price}`);
            }
        });

        // Format it beautifully for the AI
        for (const [category, items] of Object.entries(menuCategories)) {
            menuBuilder += `*${category}*\n${items.join('\n')}\n\n`;
        }

        liveMenuCache = menuBuilder;
        console.log("✅ Live Menu Successfully Synced from Google Sheets!");
    } catch (error) {
        console.error("❌ Failed to sync menu:", error.message);
    }
}

// Trigger a sync when the server first starts!
syncMenuFromDatabase();


// --- AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemInstruction = `You are the friendly customer service AI for Shawarma Plug. 
Your job is to chat with customers, answer their questions, take orders, and finalize details.

*DELIVERY ZONES*
(A): Southgate (close by) - N800
(B): Northgate (close by) - N2000
(C): Inside FUTA Campus Hostels - N400
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

STEP 1: GENERAL CUSTOMER CARE & MENU PRESENTATION
* You will receive the active menu attached to the user's message. IT IS LIVE DATA. Only offer items listed as available.
* IF a customer simply asks "Menu" or "What do you have?": DO NOT show them everything at once. 
* Say: "We have some delicious options today! \n\n🌯 Shawarmas & Breadwarma \n🍗 Chicken & Chips \n🍹 Drinks \n\nWhich one would you like to see?"

STEP 2: THE STEP-BY-STEP ORDERING FLOW (CRITICAL)
* NEVER send a bulky text block with all the prices at once. Guide them step-by-step.
* IF THEY CHOOSE SHAWARMA/BREADWARMA:
  1. First, ask them what size they want: "Would you like the \n\n~ Solo (Single Sausage), \n~ Mini (Double Sausage), \n~ Jumbo (Triple Sausage), \nor Breadwarma?"
  2. WAIT for them to reply.
  3. Once they choose a size, ask: "Awesome! Would you prefer Beef or Chicken?"
  4. WAIT for them to reply.
  5. ONLY AFTER they have chosen the size AND the meat, check your LIVE MENU KNOWLEDGE BASE, tell them the exact price for that specific item, and ask if they want to add a cold drink!
* IF THEY CHOOSE CHICKEN & CHIPS OR DRINKS: Use the same step-by-step logic. Ask for the size or type first, wait for a reply, and then give the specific price.

STEP 3: PICKUP OR DELIVERY
* Ask: "Will this be for Pickup or Delivery?"
* IF PICKUP: Ask for the pickup name.
* IF DELIVERY: 
  - Present the Delivery Zones (A, B, C, D, E) and ask them to select one. 
  - If they choose A, B, C, or D: calculate the new total including the delivery fee, THEN ask for their EXACT location and active phone number for the rider.
  - IF THEY CHOOSE ZONE E (CRITICAL TWO-PART STEP):
    PART 1: Ask for their EXACT delivery address and active phone number. YOU MUST STOP HERE. Do NOT say anything else. Wait for the customer to reply.
    PART 2: ONLY AFTER the customer replies with their actual address, output this exact tag: [PRICE_REQUEST]
    PART 3: Along with the tag, say: "Please give me just a moment! I am checking with our dispatch rider to get the exact delivery fee for your location. 🛵💨"
    PART 4: STOP. Do not proceed to Step 4 until the system updates you with the price.

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
Order: 1x Jumbo Beef, 1x 35Cl Strawberry Milkshake
Total: N8300
[END_TICKET]

* CRITICAL PAYMENT ROUTING: After the [END_TICKET] tag, tell the customer to make a single transfer for the total amount to: 5875254742 \n\nMoniepoint \nShawarma Plug Crib.
* NEVER confirm payments yourself. After giving the BANK details, you MUST say: "Upload your receipt screenshot(s) right here! I will send it to our manager and confirm your order for you the second it is verified. ⏳"

STEP 6: POST-PAYMENT & ADD-ONS
* If a customer texts you again AFTER they upload their receipt, check your chat history! 
* IF NO CONFIRMATION YET: Politely stall: "Please give me just a moment! The manager is still verifying your receipt with the kitchen."
* IF ALREADY CONFIRMED: Resume normal conversation.
* IF THEY WANT TO ADD ITEMS AFTER PAYMENT (The Permission Gateway):
  - Because their food might already be packed or dispatched, you MUST ask the manager for permission first!
  - Output this exact tag: [ADD_ON_REQUEST]
  - IF THEY CHOSE DELIVERY: Say, "Let me quickly check with the kitchen to see if your rider has left yet! 🏃‍♂️💨 Give me just a second."
  - IF THEY CHOSE PICKUP: Say, "Let me quickly check with the kitchen to see if your order is already packed up! 🛍️ Give me just a second."
  - STOP. Do not generate a ticket. Wait for the manager's system message.

STEP 7: THE SMART ESCAPE HATCH & CANCELLATIONS
* ONLY use this step if a customer has a serious complaint (cold food, late rider), explicitly demands a human, OR wants to cancel their order.
* IF CUSTOMER CANCELS: Acknowledge the cancellation warmly, say "No worries at all!", and completely forget about their cart. YOU MUST output this exact tag anywhere in your message: [CANCEL_ORDER]
* FOR COMPLAINTS/ESCALATIONS: Check your chat history first! 
* IF YOU ALREADY ESCALATED: DO NOT output the tag again. Just politely stall: "The manager is reviewing your ticket right now and will reply to you here shortly! 🙏"
* IF THIS IS THE FIRST TIME ESCALATING: You MUST output the secret tag exactly like this at the very beginning of your message: [HUMAN_NEEDED]
* Directly after the tag, say: "I am so sorry about this! I am alerting our human manager right now. They will step into this chat in just a moment to help sort this out for you."

STEP 8: THE REBOOT APOLOGY (SERVER AMNESIA)
* Because you run on a cloud server, your memory resets if the chat is inactive for 15 minutes. 
* Use your reasoning: If a customer seems confused that you don't remember their order, realize that your memory might have reset.
* DO NOT argue with them or show them the menu blindly. 
* Say: "I am so sorry! My system had a quick network refresh and I lost my memory of your cart. 🥺 Could you please tell me your order one more time so I can rush it to the kitchen?"
  
FORMATTING (CRITICAL):
* You are allowed to use asterisks (*) ONLY to bold the category headers (e.g., *🌯 SHAWARMA*). 
* Do NOT use any other markdown like # or **. 
* When sending a menu category, use double line breaks so it is easy to read.
* Never send long, exhausting paragraphs. Use short, punchy sentences.`;

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
const humanOverride = new Set(); 
const processedMessages = new Set(); // <-- META DUPLICATE BOUNCER MEMORY ADDED HERE

// --- ADMIN BROADCAST LIST ---
const ADMIN_NUMBERS = [
    '2347087505608', // You
    '2348133728255'  // Kitchen Manager
];

// --- SAAS SUBSCRIPTION STATE ---
let isSubscriptionActive = true; 
const SUPER_ADMIN = '2347087505608'; 

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

    const openingHour = 16; // 4:00 PM
    const closingHour = 21; // 9:00 PM

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

    // Injecting the dynamic Google Sheets menu directly into the prompt!
    let finalPrompt = `[CURRENT MENU DATABASE]\n${liveMenuCache}\n\nCustomer says: ${userQuestion}`;
    
    try {
        const result = await chat.sendMessage(finalPrompt);
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
                const result = await chat.sendMessage(finalPrompt);
                return result.response.text();
            } catch (fallbackError) {
                console.error("🚨 FALLBACK AI INSTANT CRASH:", fallbackError.message);
                return "Sorry, our system is experiencing heavy traffic! \n\nPlease resend your message in about a minute or two \n\n*OR* 🤙 call or message 08133728255 to place your order.";
            }
        } else {
            console.error("🚨 TOTAL AI CRASH: Both models failed.");
            return "Sorry, our system is experiencing heavy traffic! \n\nPlease resend your message in about a minute or two \n\n*OR* 🤙 call or message 08133728255 to place your order.";
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
        
        // --- 🛑 META TIMEOUT FIX: Instantly tell Meta we got the message to stop double-texting! ---
        res.sendStatus(200);

        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message?.type === 'text') {
            // --- META DUPLICATE BLOCKER ADDED HERE ---
            const messageId = message.id;
            if (processedMessages.has(messageId)) return; 
            processedMessages.add(messageId);
            if (processedMessages.size > 1000) processedMessages.clear();
            // -----------------------------------------

            const customerPhone = message.from;
            const customerText = message.text.body;
            const phoneId = value.metadata.phone_number_id; 

            // --- SAAS KILL SWITCH INTERCEPTOR ---
            if (!isSubscriptionActive && customerPhone !== SUPER_ADMIN) {
                let suspendMessage = "";
                if (ADMIN_NUMBERS.includes(customerPhone)) {
                    suspendMessage = "🚨 SYSTEM SUSPENDED 🚨\nYour AI Assistant subscription is overdue or disabled. Please contact your developer to reactivate the system.";
                } else {
                    suspendMessage = "Our AI ordering system is currently offline for maintenance! 🛠️\n\nPlease call or WhatsApp 08133728255 to place your order directly with the kitchen.";
                }

                await axios({
                    method: 'POST',
                    url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
                    data: { messaging_product: 'whatsapp', to: customerPhone, text: { body: suspendMessage } },
                });
                return; 
            }

            // --- ADMIN CONTROLS ---
            if (ADMIN_NUMBERS.includes(customerPhone) && customerText.startsWith('/')) {
                const command = customerText.toLowerCase().trim();
                let adminReply = "";

                if (command === '/close') {
                    manualShopState = 'closed';
                    adminReply = "🛑 ADMIN: Shop is now manually CLOSED.";
                } else if (command === '/open') {
                    manualShopState = 'open';
                    adminReply = "✅ ADMIN: Shop is now manually OPEN.";
                } else if (command === '/auto') {
                    manualShopState = 'auto';
                    adminReply = "⏱️ ADMIN: Shop is back on AUTO mode.";
                } else if (command === '/pause') {
                    manualShopState = 'closed'; 
                    pauseMessage = "We are running a little behind schedule today! ⏳\n\nPlease give us a few minutes and check back soon, or message our manager at 08133728255.";
                    adminReply = "⏸️ ADMIN: Shop is PAUSED.";
                
                // --- MANUAL MENU SYNC ---
                } else if (command === '/sync') {
                    adminReply = "🔄 Syncing menu from Google Sheets... Give me a second!";
                    await syncMenuFromDatabase();
                    adminReply = "✅ SYNC COMPLETE! The bot now has the latest prices and stock availability.";

                // --- PRICE INJECTION ---
                } else if (command.startsWith('/price')) {
                    const parts = command.split(' ');
                    if (parts.length >= 3) {
                        const targetOrder = parts[1].toUpperCase();
                        const priceAmount = parts[2];
                        let targetPhone = getPhoneByOrderCode(targetOrder);
                        if (!targetPhone && targetOrder.startsWith('234')) targetPhone = targetOrder; 

                        if (targetPhone) {
                            const injectionPrompt = `[SYSTEM MESSAGE]: The manager has confirmed the delivery fee for Zone E is N${priceAmount}. Tell the customer Delivery Confirmed, add it to their total, and ask if their order is complete to proceed to checkout!`;
                            const aiFollowUp = await askGemini(targetPhone, injectionPrompt);

                            await axios({
                                method: 'POST',
                                url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                                headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
                                data: { messaging_product: 'whatsapp', to: targetPhone, text: { body: aiFollowUp.replace('[PRICE_REQUEST]', '').trim() } },
                            });
                            adminReply = `✅ Done! I told the customer delivery is N${priceAmount} and resumed their chat.`;
                        } else {
                            adminReply = `❌ Error: Could not find an active chat for ${targetOrder}.`;
                        }
                    } else {
                        adminReply = `❌ Invalid format. Please use: /price SP-XXXX 500`;
                    }
                
                // --- ORDER CONFIRMATION & DB UPDATE ---
                } else if (command.startsWith('/confirm')) {
                    const parts = command.split(' ');
                    if (parts.length >= 2) {
                        const targetOrder = parts[1].toUpperCase();
                        const dbPhone = await confirmOrderInDatabase(targetOrder);
                        let targetPhone = dbPhone || getPhoneByOrderCode(targetOrder);
                        if (!targetPhone && targetOrder.startsWith('234')) targetPhone = targetOrder; 

                        if (targetPhone) {
                            const injectionPrompt = `[SYSTEM MESSAGE]: Payment confirmed for ${targetOrder}! The manager officially updated the database. Tell the customer their order is confirmed and the kitchen is on it. If they chose Pickup, say it will be ready in 5-10 mins. If Delivery, say 10-25 mins. Keep it very short, warm, and nice.`;
                            const aiFollowUp = await askGemini(targetPhone, injectionPrompt);

                            await axios({
                                method: 'POST',
                                url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                                headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
                                data: { messaging_product: 'whatsapp', to: targetPhone, text: { body: aiFollowUp.replace('[PRICE_REQUEST]', '').trim() } },
                            });
                            adminReply = `✅ Done! I marked ${targetOrder} as CONFIRMED in the Google Sheet and texted the customer.`;
                        } else {
                            adminReply = `❌ Error: Could not find ${targetOrder} in the Database or memory.`;
                        }
                    } else {
                        adminReply = `❌ Invalid format. Please use: /confirm SP-XXXX`;
                    }

                // --- ADD-ON PERMISSIONS ---
                } else if (command.startsWith('/allow') || command.startsWith('/deny')) {
                    const parts = command.split(' ');
                    if (parts.length >= 2) {
                        const action = parts[0].substring(1); 
                        const targetOrder = parts[1].toUpperCase();
                        let targetPhone = getPhoneByOrderCode(targetOrder);
                        if (!targetPhone && targetOrder.startsWith('234')) targetPhone = targetOrder; 

                        if (targetPhone) {
                            let injectionPrompt = "";
                            if (action === 'allow') {
                                injectionPrompt = `[SYSTEM MESSAGE]: The manager APPROVED the add-on! The food is still in the kitchen. Tell the customer the news, calculate the extra price, and ask if they want you to add it to their ticket!`;
                            } else {
                                injectionPrompt = `[SYSTEM MESSAGE]: The manager DENIED the add-on because the food has already been dispatched or packed up. Apologize warmly to the customer and tell them we can't add to this specific order anymore.`;
                            }                            
                            
                            const aiFollowUp = await askGemini(targetPhone, injectionPrompt);

                            await axios({
                                method: 'POST',
                                url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                                headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
                                data: { messaging_product: 'whatsapp', to: targetPhone, text: { body: aiFollowUp.replace('[ADD_ON_REQUEST]', '').trim() } },
                            });
                            adminReply = `✅ Done! I told the customer their add-on was ${action.toUpperCase()}ED.`;
                        } else {
                            adminReply = `❌ Error: Could not find an active chat for ${targetOrder}.`;
                        }
                    } else {
                        adminReply = `❌ Invalid format. Please use: /allow SP-XXXX or /deny SP-XXXX`;
                    }
                
                // --- DIRECT CUSTOMER MESSAGE (LIVE CHAT OVERRIDE) ---
                } else if (command.startsWith('/msg')) {
                    const parts = customerText.split(' '); 
                    if (parts.length >= 3) {
                        const targetIdentifier = parts[1].toUpperCase();
                        let targetPhone = getPhoneByOrderCode(targetIdentifier);
                        if (!targetPhone && targetIdentifier.startsWith('234')) targetPhone = targetIdentifier; 
                        const customMessage = parts.slice(2).join(' '); 

                        if (targetPhone) {
                            const isAlreadyPaused = humanOverride.has(targetPhone);
                            humanOverride.add(targetPhone);

                            await axios({
                                method: 'POST',
                                url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                                headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
                                data: { messaging_product: 'whatsapp', to: targetPhone, text: { body: `*Message from Manager:*\n${customMessage}` } },
                            });
                            
                            if (isAlreadyPaused) {
                                adminReply = `✅ Message delivered.`; 
                            } else {
                                adminReply = `✅ Message delivered. 🛑 AI is now PAUSED for ${targetIdentifier}. Any replies from them will be forwarded to you.`; 
                            }
                        } else {
                            adminReply = `❌ Error: Could not find an active chat for ${targetIdentifier}.`;
                        }
                    } else {
                        adminReply = `❌ Invalid format. Please use: /msg SP-XXXX Your custom message here`;
                    }

                // --- RESUME AI CONTROL ---
                } else if (command.startsWith('/resume')) {
                    const parts = command.split(' ');
                    if (parts.length >= 2) {
                        const targetIdentifier = parts[1].toUpperCase();
                        let targetPhone = getPhoneByOrderCode(targetIdentifier);
                        if (!targetPhone && targetIdentifier.startsWith('234')) targetPhone = targetIdentifier; 

                        if (targetPhone) {
                            humanOverride.delete(targetPhone); 
                            adminReply = `✅ AI has resumed taking orders for ${targetIdentifier}. They are back on Auto.`;
                        } else {
                            adminReply = `❌ Error: Could not find an active chat for ${targetIdentifier}.`;
                        }
                    } else {
                        adminReply = `❌ Invalid format. Please use: /resume SP-XXXX`;
                    }
                
                // --- SYSTEM STATUS CHECK ---
                } else if (command === '/status') {
                    if (humanOverride.size === 0) {
                        adminReply = "📊 SYSTEM STATUS: All customers are currently chatting with the AI. No active live chats.";
                    } else {
                        let liveChats = [];
                        for (const phone of humanOverride) {
                            const code = getOrderCode(phone) || phone;
                            liveChats.push(`- ${code}`);
                        }
                        adminReply = `📊 ACTIVE LIVE CHATS (${humanOverride.size}):\nThe AI is currently PAUSED for the following orders:\n${liveChats.join('\n')}\n\nRemember to use /resume SP-XXXX when you are done!`;
                    }

                // --- SAAS BILLING CONTROLS (SUPER ADMIN ONLY) ---
                } else if (command === '/shutdown') {
                    if (customerPhone === SUPER_ADMIN) {
                        isSubscriptionActive = false;
                        adminReply = "🔴 SAAS KILL SWITCH ACTIVATED: The bot is now offline for all customers and admins.";
                    } else {
                        adminReply = "❌ Unauthorized. Only the system developer can use this command.";
                    }
                } else if (command === '/restart') {
                    if (customerPhone === SUPER_ADMIN) {
                        isSubscriptionActive = true;
                        adminReply = "🟢 SAAS SYSTEM REACTIVATED: The bot is back online and accepting orders.";
                    } else {
                        adminReply = "❌ Unauthorized. Only the system developer can use this command.";
                    }

                // --- UNKNOWN COMMAND FALLBACK ---
                } else {
                    adminReply = "❌ Unknown command. Use /open, /close, /pause, /auto, /sync, /price SP-XXXX AMOUNT, /confirm SP-XXXX, /msg SP-XXXX text, /allow SP-XXXX, /deny SP-XXXX, /status, /resume SP-XXXX, /shutdown, or /restart.";
                }

                // --- SEND THE ADMIN REPLY ---
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
                return; 
            }
            
            // --- CUSTOMER FLOW ---
            if (!isShopOpen()) {
                let excuseToGive = "We are currently closed! 🌙\n\nOur kitchen opens at 4:00 PM and the Shop opens at 6:00 PM.\n WE close 9PM.\nThanks!";
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
                return; 
            }
            
            // --- THE HUMAN HANDOFF INTERCEPTOR ---
            if (humanOverride.has(customerPhone)) {
                const uniqueCode = getOrderCode(customerPhone);
                
                for (const adminPhone of ADMIN_NUMBERS) {
                    try {
                        await axios({
                            method: 'POST',
                            url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
                            data: { messaging_product: 'whatsapp', to: adminPhone, text: { body: `💬 LIVE CHAT (${uniqueCode}):\n"${customerText}"\n\nTo reply: /msg ${uniqueCode} your text\nTo end chat: /resume ${uniqueCode}` } },
                        });
                    } catch (err) { console.error("Failed to forward live chat."); }
                }
                return; 
            }
            
            pauseMessage = ""; 
            
            // Let the AI take the wheel
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
                        // Clean tags from customer view!
                        text: { body: aiReply.replace(/\[CURRENT MENU DATABASE[\s\S]*?\]\n\n/g, '').replace('[NEW_ORDER]', '').replace('[ADD_ON_ORDER]', '').replace('[HUMAN_NEEDED]', '').replace('[END_TICKET]', '').replace('[PRICE_REQUEST]', '').replace('[ADD_ON_REQUEST]', '').replace('[CANCEL_ORDER]', '').trim() },
                    },
                });

                // --- CEO TICKET ROUTER ---
                if (aiReply.includes('[NEW_ORDER]') || aiReply.includes('[ADD_ON_ORDER]') || aiReply.includes('[HUMAN_NEEDED]') || aiReply.includes('[PRICE_REQUEST]') || aiReply.includes('[ADD_ON_REQUEST]') || aiReply.includes('[CANCEL_ORDER]')) {
                    const uniqueCode = getOrderCode(customerPhone);
                    const now = new Date();
                    const timeString = now.toLocaleString("en-US", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
                    
                    let alertType = "🚨 KITCHEN ALERT 🚨";
                    let adminMessageContent = "";

                    if (aiReply.includes('[HUMAN_NEEDED]')) {
                        alertType = "🚨 MANAGER ASSISTANCE NEEDED 🚨\nTap the number below to message them immediately!";
                        adminMessageContent = `Customer said:\n"${customerText}"`;
                    
                    } else if (aiReply.includes('[PRICE_REQUEST]')) {
                        alertType = `🚨 DELIVERY QUOTE NEEDED 🚨\nTo set the price, reply to me with exactly:\n/price ${uniqueCode} 500`;
                        adminMessageContent = `Customer's Address:\n"${customerText}"`;

                    } else if (aiReply.includes('[ADD_ON_REQUEST]')) {
                        alertType = `🚨 ADD-ON PERMISSION REQUEST 🚨\nCheck if food is still there! To approve, reply:\n/allow ${uniqueCode}\nTo reject, reply:\n/deny ${uniqueCode}`;
                        adminMessageContent = `Customer wants to add:\n"${customerText}"`;
                    
                    } else if (aiReply.includes('[CANCEL_ORDER]')) {
                        alertType = `🚫 ORDER CANCELLED 🚫\nABORT! DO NOT COOK! The customer just cancelled this order.`;
                        adminMessageContent = `Customer said:\n"${customerText}"`;

                    } else {
                        let cleanAdminAlert = aiReply;
                        if (aiReply.includes('[END_TICKET]')) {
                            cleanAdminAlert = aiReply.split('[END_TICKET]')[0].trim();
                        }
                        adminMessageContent = cleanAdminAlert.replace('[NEW_ORDER]', '').replace('[ADD_ON_ORDER]', '').trim();

                        if (aiReply.includes('[NEW_ORDER]')) {
                            saveOrderToDatabase(customerPhone, adminMessageContent, uniqueCode);
                        }
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
                                    text: { body: `${alertType}\n🕒 ${timeString}\nOrder ID: ${uniqueCode}\nFrom Customer: +${customerPhone}\n\n${adminMessageContent}` },
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
            // --- META DUPLICATE BLOCKER FOR IMAGES ADDED HERE ---
            const messageId = message.id;
            if (processedMessages.has(messageId)) return; 
            processedMessages.add(messageId);
            if (processedMessages.size > 1000) processedMessages.clear();
            // ----------------------------------------------------

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
                        text: { body: "Receipt received! 🧾 I am sending this to our human manager to verify right now. I will message you back the second your order is confirmed! ⏳" },
                    },
                });

                const uniqueCode = getOrderCode(customerPhone); 
                const now = new Date();
                const timeString = now.toLocaleString("en-US", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
                
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
                                text: { body: `🚨 RECEIPT ALERT 🚨\n🕒 ${timeString}\nOrder ID: ${uniqueCode}\nFrom Customer: +${customerPhone}\n\nTo approve this order and update the database, reply to me with:\n/confirm ${uniqueCode}` },
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
    } 
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Bot server is running on port ${PORT}`);
});
