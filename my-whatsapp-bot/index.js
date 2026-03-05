require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(express.json());

// --- WHITE-LABEL CONFIGURATION ENGINES ---
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Our Shop";
const BUSINESS_PHONE = process.env.BUSINESS_PHONE || "our support line";
const ORDER_PREFIX = process.env.ORDER_PREFIX || "ORD";
const SUPER_ADMIN = process.env.SUPER_ADMIN_NUMBER;
const ADMIN_NUMBERS = process.env.ADMIN_NUMBERS ? process.env.ADMIN_NUMBERS.split(',') : [];

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
        console.log(`✅ [Database] SUCCESS: Order ${orderId} safely stored!`);
    } catch (error) {
        console.error("❌ [Database Error] Failed to save to Google Sheets:", error.message);
    }
}

async function confirmOrderInDatabase(orderId) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();

        const cleanId = orderId.replace(/[-\s]/g, '').toUpperCase();

        const targetRow = rows.find(r => {
            const id = r.OrderID || (typeof r.get === 'function' && r.get('OrderID'));
            const cleanRowId = (id || "").toString().replace(/[-\s]/g, '').toUpperCase();
            return cleanRowId === cleanId;
        });

        if (targetRow) {
            if (typeof targetRow.assign === 'function') targetRow.assign({ Status: '✅ CONFIRMED' });
            else if (typeof targetRow.set === 'function') targetRow.set('Status', '✅ CONFIRMED');
            else targetRow.Status = '✅ CONFIRMED';
            
            await targetRow.save();

            const phone = targetRow.Phone || (typeof targetRow.get === 'function' && targetRow.get('Phone'));
            return phone ? phone.replace('+', '') : null;
        }
        return null; 
    } catch (error) {
        console.error("❌ [Database Error] Update failed:", error.message);
        return null;
    }
}

// --- DYNAMIC MENU STATE & FETCHER ---
let liveMenuCache = "Menu is currently syncing...";

async function syncMenuFromDatabase() {
    try {
        await doc.loadInfo(); 
        const menuSheet = doc.sheetsByIndex[1]; 
        if (!menuSheet) {
            console.error("❌ [Menu Error] Could not find Sheet2. Please create a 2nd tab for the menu.");
            return;
        }
        
        const rows = await menuSheet.getRows();
        let menuBuilder = "*LIVE MENU KNOWLEDGE BASE*\n(Use these exact prices and items. DO NOT offer items that are not on this list. If a category is empty, it means we are out of stock of everything in it.)\n\n";
        let menuCategories = {};

        rows.forEach(row => {
            const category = row.get('Category');
            const item = row.get('Item');
            const price = row.get('Price');
            const available = row.get('Available');

            if (available && available.toString().toUpperCase() === 'TRUE') {
                if (!menuCategories[category]) menuCategories[category] = [];
                menuCategories[category].push(`~ ${item}: N${price}`);
            }
        });

        for (const [category, items] of Object.entries(menuCategories)) {
            menuBuilder += `*${category}*\n${items.join('\n')}\n\n`;
        }

        liveMenuCache = menuBuilder;
        console.log(`✅ [Menu] Live Menu Synced for ${BUSINESS_NAME}!`);
    } catch (error) {
        console.error("❌ [Menu Error] Failed to sync menu:", error.message);
    }
}

syncMenuFromDatabase();

// --- AI SETUP (THE 3-KEY FORTRESS) ---

// Assuming you still have your system prompt directly in the file for Tier 1
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
* Say exactly: "Good [morning/afternoon/evening] [Customer Name].\nWelcome to Shawarma Plug! We have some delicious options today! \n\n🌯 Shawarmas & Breadwarma \n🍗 Chicken & Chips \n🍹 Drinks \n\nWhich one would you like to see?"

STEP 2: THE STEP-BY-STEP ORDERING FLOW (CRITICAL)
* NEVER send a bulky text block with all the prices at once. Guide them step-by-step.
* IF THEY CHOOSE SHAWARMA/BREADWARMA:
  1. First, ask them what size they want: "Would you like the \n\n~ Solo (Single Sausage), \n~ Mini (Double Sausage), \n~ Jumbo (Triple Sausage), \n~ Breadwarma?"
  2. WAIT for them to reply.
  3. Once they choose a size, ask: "Awesome! Would you prefer Beef or Chicken?"
  4. WAIT for them to reply.
  5. ONLY AFTER they have chosen the size AND the meat, check your LIVE MENU KNOWLEDGE BASE, tell them the exact price for that specific item, and ask if they want to add a drink or extras!
  6. Note: For extras(cheese, beef, cream and sausage) the sausage is not available for shawarma only for breadwarma.
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

// 🧠 Brain 1: The Main Customer-Facing AI (Uses Key 1)
const genAI_Primary = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_PRIMARY);
const primaryModel = genAI_Primary.getGenerativeModel({ model: "gemini-2.5-flash-lite", systemInstruction: systemInstruction });

// 🧠 Brain 2: The Customer Fallback AI (Uses Key 2 - Steps in if Key 1 crashes)
const genAI_Fallback = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_FALLBACK);
const fallbackModel = genAI_Fallback.getGenerativeModel({ model: "gemini-2.5-flash-lite", systemInstruction: systemInstruction });

const adminSystemInstruction = `You are the silent backend JSON AI Assistant for the Manager of ${BUSINESS_NAME}.
Your ONLY job is to read the Manager's natural language requests and translate them into a strict, valid JSON array of action objects. 
NEVER output conversational text. Output ONLY the raw JSON array.

*NORMALIZATION RULES:*
Format any order ID perfectly using the business prefix: "${ORDER_PREFIX}-1234".

*ALLOWED ACTIONS:*
- Confirm order: { "action": "confirm", "orderId": "${ORDER_PREFIX}-1234" }
- Set delivery price: { "action": "price", "orderId": "${ORDER_PREFIX}-1234", "amount": 500 }
- Allow add-on: { "action": "allow", "orderId": "${ORDER_PREFIX}-1234" }
- Deny add-on: { "action": "deny", "orderId": "${ORDER_PREFIX}-1234" }
- Message customer directly: { "action": "msg", "targetIdentifier": "${ORDER_PREFIX}-1234", "text": "we are out of stock" }
- Resume AI control: { "action": "resume", "targetIdentifier": "${ORDER_PREFIX}-1234" }
- Open shop: { "action": "open" }
- Close shop: { "action": "close" }
- Auto hours: { "action": "auto" }
- Pause shop: { "action": "pause" }
- Sync menu: { "action": "sync" }
- Check status or ask if shop is open: { "action": "status" }
- Unknown command: { "action": "error", "message": "I didn't understand that command." }

You must output an array containing ALL actions requested.`;

// 🧠 Brain 3: The Dedicated Admin AI (Uses Key 3 - NEVER shares a limit with customers)
const genAI_Admin = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_ADMIN);
const adminModel = genAI_Admin.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    systemInstruction: adminSystemInstruction,
    generationConfig: { responseMimeType: "application/json" } 
});

const activeConversations = new Map(); // Standard Tier RAM Memory
const orderCodes = new Map(); 
const humanOverride = new Set(); 
const processedMessages = new Set(); 

let isSubscriptionActive = true; 

function getOrderCode(customerPhone) {
    if (!orderCodes.has(customerPhone)) {
        const newCode = ORDER_PREFIX + "-" + Math.floor(1000 + Math.random() * 9000);
        orderCodes.set(customerPhone, newCode);
    }
    return orderCodes.get(customerPhone);
}

function getPhoneByOrderCode(searchCode) {
    if (!searchCode) return null;
    const cleanSearch = searchCode.replace(/[-\s]/g, '').toUpperCase();
    for (let [phone, code] of orderCodes.entries()) {
        const cleanCode = code.replace(/[-\s]/g, '').toUpperCase();
        if (cleanCode === cleanSearch) return phone;
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

async function askGemini(customerPhone, customerName, userQuestion, retries = 2) {
    let chat = activeConversations.get(customerPhone);

    if (!chat) {
        chat = primaryModel.startChat({ history: [] });
        chat.activeModel = 'primary'; 
        activeConversations.set(customerPhone, chat);
    }
    
    if (liveMenuCache === "Menu is currently syncing...") {
        console.log("⏳ [System] Forcing a rapid menu fetch before AI answers...");
        await syncMenuFromDatabase();
    }

    let finalPrompt = `[CURRENT MENU DATABASE]\n${liveMenuCache}\n\n[Customer Name: ${customerName}]\nCustomer says: ${userQuestion}`;
    
    try {
        const result = await chat.sendMessage(finalPrompt);
        return result.response.text();
    } catch (error) {
        // 🤫 QUIET LOGS: Hide Google's massive error paragraph
        console.warn(`⚠️ [AI Error] ${chat.activeModel.toUpperCase()} AI hit a snag for +${customerPhone}.`);

        if (retries > 0) {
            console.log(`⏳ [AI Retry] Waiting 3 seconds... (${retries} retries left)`);
            await delay(3000); 
            return await askGemini(customerPhone, customerName, userQuestion, retries - 1); 
        }

        if (chat.activeModel === 'primary') {
            console.log(`🔄 [AI Fallback] Rerouting +${customerPhone} to Fallback AI...`);
            let oldHistory = [];
            try { oldHistory = await chat.getHistory(); } catch (e) {}

            chat = fallbackModel.startChat({ history: oldHistory });
            chat.activeModel = 'fallback'; 
            activeConversations.set(customerPhone, chat);

            try {
                const result = await chat.sendMessage(finalPrompt);
                const aiFallbackResponse = result.response.text();
                console.log(`✅ [AI Fallback] Successfully answered +${customerPhone}.`);
                return aiFallbackResponse;
            } catch (fallbackError) {
                console.error(`🚨 [AI FATAL] Fallback crashed for +${customerPhone}.`);
                return `Sorry, our system is busy! Please message or call ${BUSINESS_PHONE} to place your order.`;
            }
        } else {
            console.error(`🚨 [AI FATAL] Total AI crash for +${customerPhone}.`);
            return `Sorry, our system is busy! Please message or call ${BUSINESS_PHONE} to place your order.`;
        }
    }
}

// --- WHATSAPP SENDER HELPER FUNCTION ---
async function sendWhatsApp(phoneId, to, body) {
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            data: { messaging_product: 'whatsapp', to: to, text: { body: body } }
        });
        console.log(`📤 [WhatsApp] Sent message to +${to}`);
    } catch (err) {
        console.error(`❌ [WhatsApp Error] Failed to send to +${to}:`, err.response ? JSON.stringify(err.response.data) : err.message);
    }
}

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        res.sendStatus(200);

        const value = body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (message?.type === 'text' || message?.type === 'location') {
            const messageId = message.id;
            if (processedMessages.has(messageId)) return; 
            processedMessages.add(messageId);
            if (processedMessages.size > 1000) processedMessages.clear();

            const msgTimestamp = parseInt(message.timestamp, 10);
            if (Math.floor(Date.now() / 1000) - msgTimestamp > 300) {
                console.log(`⏳ [Webhook] Ignored stale message from +${message.from} (Meta retry).`);
                return;
            }

            const customerPhone = message.from;
            const phoneId = value.metadata.phone_number_id; 
            const customerName = value.contacts?.[0]?.profile?.name || "Customer";
            let customerText = message.type === 'text' ? message.text.body : "📍 [Sent a Location Pin for Address]";
            
            console.log(`📩 [Webhook] Received message from +${customerPhone}: "${customerText}"`);

            if (!isSubscriptionActive && customerPhone !== SUPER_ADMIN) {
                let suspendMsg = ADMIN_NUMBERS.includes(customerPhone) 
                    ? "🚨 SYSTEM SUSPENDED 🚨\nYour AI Assistant subscription is overdue." 
                    : `Our AI system is offline for maintenance! 🛠️\nPlease call ${BUSINESS_PHONE}.`;
                await sendWhatsApp(phoneId, customerPhone, suspendMsg);
                return; 
            }

            // --- NLP ADMIN COMMAND BLOCK ---
            if (ADMIN_NUMBERS.includes(customerPhone)) {
                console.log(`🛠️ [Admin] Command received from +${customerPhone}`);
                
                if (customerPhone === SUPER_ADMIN && customerText.toLowerCase() === 'shutdown') {
                    isSubscriptionActive = false;
                    await sendWhatsApp(phoneId, customerPhone, "🔴 SAAS KILL SWITCH ACTIVATED.");
                    return;
                } else if (customerPhone === SUPER_ADMIN && customerText.toLowerCase() === 'restart') {
                    isSubscriptionActive = true;
                    await sendWhatsApp(phoneId, customerPhone, "🟢 SAAS SYSTEM REACTIVATED.");
                    return;
                }

                try {
                    const adminResult = await adminModel.generateContent(`Manager request: ${customerText}`);
                    let tasks = JSON.parse(adminResult.response.text());
                    
                    // 🛡️ THE SAFETY NET: Fix JSON parsing issues
                    if (!Array.isArray(tasks)) {
                        tasks = [tasks];
                    }
                    
                    console.log(`🤖 [Admin AI] Parsed actions:`, JSON.stringify(tasks, null, 2));
                    let ceoReplySummary = [];

                    for (const task of tasks) {
                        let targetPhone = getPhoneByOrderCode(task.orderId || task.targetIdentifier);
                        if (!targetPhone && (task.orderId || task.targetIdentifier)?.startsWith('234')) {
                            targetPhone = task.orderId || task.targetIdentifier;
                        }

                        switch (task.action) {
                            case 'confirm':
                                const dbPhone = await confirmOrderInDatabase(task.orderId);
                                targetPhone = dbPhone || targetPhone;
                                if (!targetPhone) {
                                    ceoReplySummary.push(`❌ Error: Could not find ${task.orderId} in database.`);
                                } else {
                                    const aiFollowUp = await askGemini(targetPhone, "Customer", `[SYSTEM MESSAGE]: Payment confirmed for ${task.orderId}! The manager officially updated the database. Tell the customer their order is confirmed and the kitchen is on it. Keep it short, warm, and nice.`);
                                    await sendWhatsApp(phoneId, targetPhone, aiFollowUp.replace('[PRICE_REQUEST]', '').trim());
                                    ceoReplySummary.push(`✅ ${task.orderId} confirmed.`);
                                }
                                break;

                            case 'price':
                                if (!targetPhone) {
                                    ceoReplySummary.push(`❌ Error: Could not find chat for ${task.orderId}.`);
                                } else {
                                    // 🛑 THE FIX: We added a strict command telling the AI to STOP and wait for the "YES" before printing the ticket.
                                    const prompt = `[SYSTEM MESSAGE]: The manager confirmed the delivery fee is N${task.amount}. Tell the customer Delivery Confirmed, tell them the new total, and ask: "Is your order complete? Reply YES to send it to the kitchen!" CRITICAL RULE: DO NOT output the [NEW_ORDER] ticket yet. You MUST stop and wait for them to actually reply YES.`;
                                    const aiFollowUp = await askGemini(targetPhone, "Customer", prompt);
                                    await sendWhatsApp(phoneId, targetPhone, aiFollowUp.replace('[PRICE_REQUEST]', '').trim());
                                    ceoReplySummary.push(`✅ Delivery for ${task.orderId} set to N${task.amount}.`);
                                }
                                break;

                            case 'allow':
                            case 'deny':
                                if (!targetPhone) {
                                    ceoReplySummary.push(`❌ Error: Could not find chat for ${task.orderId}.`);
                                } else {
                                    let prompt = task.action === 'allow' 
                                        ? `[SYSTEM MESSAGE]: The manager APPROVED the add-on! The food is still in the kitchen. Tell the customer the news, calculate the extra price, and ask if they want to proceed!`
                                        : `[SYSTEM MESSAGE]: The manager DENIED the add-on because the food has already been dispatched. Apologize warmly to the customer and tell them we can't add to this specific order anymore.`;
                                    const aiFollowUp = await askGemini(targetPhone, "Customer", prompt);
                                    await sendWhatsApp(phoneId, targetPhone, aiFollowUp.replace('[ADD_ON_REQUEST]', '').trim());
                                    ceoReplySummary.push(`✅ Add-on ${task.action.toUpperCase()}ED for ${task.orderId}.`);
                                }
                                break;

                            case 'msg':
                                if (!targetPhone) {
                                    ceoReplySummary.push(`❌ Error: Could not find chat for ${task.targetIdentifier}.`);
                                } else {
                                    humanOverride.add(targetPhone);
                                    await sendWhatsApp(phoneId, targetPhone, `*Message from Manager:*\n${task.text}`);
                                    ceoReplySummary.push(`✅ Message sent. AI PAUSED for ${task.targetIdentifier}.`);
                                }
                                break;

                            case 'resume':
                                if (!targetPhone) {
                                    ceoReplySummary.push(`❌ Error: Could not find chat for ${task.targetIdentifier}.`);
                                } else {
                                    humanOverride.delete(targetPhone);
                                    ceoReplySummary.push(`✅ AI resumed for ${task.targetIdentifier}.`);
                                }
                                break;

                            case 'open':
                                manualShopState = 'open';
                                ceoReplySummary.push("✅ Shop is now manually OPEN.");
                                break;
                            
                            case 'close':
                                manualShopState = 'closed';
                                ceoReplySummary.push("🛑 Shop is now manually CLOSED.");
                                break;

                            case 'auto':
                                manualShopState = 'auto';
                                ceoReplySummary.push("⏱️ Shop is back on AUTO mode.");
                                break;

                            case 'pause':
                                manualShopState = 'closed';
                                pauseMessage = "We are running a little behind schedule today! ⏳\n\nPlease give us a few minutes and check back soon, or message our manager at 08133728255.";
                                ceoReplySummary.push("⏸️ Shop is PAUSED.");
                                break;

                            case 'sync':
                                await syncMenuFromDatabase();
                                ceoReplySummary.push("✅ Menu synced from Sheets!");
                                break;

                            case 'status':
                                let shopStatusStr = "";
                                if (manualShopState === 'auto') {
                                    const currentHour = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" })).getHours();
                                    const isActuallyOpen = currentHour >= 16 && currentHour < 21;
                                    shopStatusStr = `⏱️ Mode: AUTO (Currently ${isActuallyOpen ? '*OPEN* 🟢' : '*CLOSED* 🔴'})`;
                                } else if (manualShopState === 'open') {
                                    shopStatusStr = `✅ Mode: Manually *OPEN*`;
                                } else if (manualShopState === 'closed') {
                                    shopStatusStr = pauseMessage !== "" ? `⏸️ Mode: *PAUSED*` : `🛑 Mode: Manually *CLOSED*`;
                                }

                                let chatStatusStr = humanOverride.size === 0 
                                    ? "🤖 All customers are chatting with the AI." 
                                    : `👨‍💻 ACTIVE LIVE CHATS (${humanOverride.size}):\n${Array.from(humanOverride).map(p => getOrderCode(p)).join(', ')}`;

                                ceoReplySummary.push(`📊 *SYSTEM DASHBOARD*\n\n${shopStatusStr}\n\n${chatStatusStr}`);
                                break;

                            case 'error':
                                ceoReplySummary.push(`⚠️ ${task.message}`);
                                break;
                        }
                    }
                    
                    if (ceoReplySummary.length > 0) {
                        await sendWhatsApp(phoneId, customerPhone, ceoReplySummary.join('\n\n'));
                    }

                } catch (error) {
                    console.error("❌ [Admin AI Error] Failed to parse command. Rate limit likely hit.");
                    await sendWhatsApp(phoneId, customerPhone, "❌ I had trouble understanding that command (or the system is busy). Could you rephrase it?");
                }
                
                return; 
            }
            
            // --- CUSTOMER FLOW ---
            if (!isShopOpen()) {
                let excuseToGive = pauseMessage || `We are currently closed! 🌙\n\nOur kitchen opens at 4:00 PM and the Shop opens at 6:00 PM.\n WE close 9PM.\nThanks!`;
                await sendWhatsApp(phoneId, customerPhone, excuseToGive);
                return; 
            }
            
            if (humanOverride.has(customerPhone)) {
                const uniqueCode = getOrderCode(customerPhone);
                for (const adminPhone of ADMIN_NUMBERS) {
                    await sendWhatsApp(phoneId, adminPhone, `💬 LIVE CHAT (${uniqueCode}):\n"${customerText}"`);
                }
                return; 
            }
            
            pauseMessage = ""; 
            
            const aiReply = await askGemini(customerPhone, customerName, customerText);
            const cleanReply = aiReply.replace(/\[CURRENT MENU DATABASE[\s\S]*?\]\n\n/g, '').replace('[NEW_ORDER]', '').replace('[ADD_ON_ORDER]', '').replace('[HUMAN_NEEDED]', '').replace('[END_TICKET]', '').replace('[PRICE_REQUEST]', '').replace('[ADD_ON_REQUEST]', '').replace('[CANCEL_ORDER]', '').trim();
            
            await sendWhatsApp(phoneId, customerPhone, cleanReply);

            if (aiReply.includes('[NEW_ORDER]') || aiReply.includes('[ADD_ON_ORDER]') || aiReply.includes('[HUMAN_NEEDED]') || aiReply.includes('[PRICE_REQUEST]') || aiReply.includes('[ADD_ON_REQUEST]') || aiReply.includes('[CANCEL_ORDER]')) {
                const uniqueCode = getOrderCode(customerPhone);
                const now = new Date();
                const timeString = now.toLocaleString("en-US", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
                
                let alertType = "🚨 KITCHEN ALERT 🚨";
                let adminMessageContent = "";

                if (aiReply.includes('[HUMAN_NEEDED]')) {
                    alertType = "🚨 MANAGER ASSISTANCE NEEDED 🚨";
                    adminMessageContent = `Customer said:\n"${customerText}"`;
                } else if (aiReply.includes('[PRICE_REQUEST]')) {
                    alertType = `🚨 DELIVERY QUOTE NEEDED 🚨`;
                    adminMessageContent = `Customer Address:\n"${customerText}"\n\nJust tell me: "Set delivery price for ${uniqueCode} to ___"`;
                } else if (aiReply.includes('[ADD_ON_REQUEST]')) {
                    alertType = `🚨 ADD-ON PERMISSION REQUEST 🚨`;
                    adminMessageContent = `Wants to add:\n"${customerText}"\n\nJust tell me: "Allow add on for ${uniqueCode}" or "Deny ${uniqueCode}"`;
                } else if (aiReply.includes('[CANCEL_ORDER]')) {
                    alertType = `🚫 ORDER CANCELLED 🚫\nABORT! DO NOT COOK!`;
                    adminMessageContent = `Customer said:\n"${customerText}"`;
                } else {
                    let cleanAdminAlert = aiReply;
                    if (aiReply.includes('[END_TICKET]')) cleanAdminAlert = aiReply.split('[END_TICKET]')[0].trim();
                    adminMessageContent = cleanAdminAlert.replace('[NEW_ORDER]', '').replace('[ADD_ON_ORDER]', '').trim();

                    if (aiReply.includes('[NEW_ORDER]')) saveOrderToDatabase(customerPhone, adminMessageContent, uniqueCode);
                }

                for (const adminPhone of ADMIN_NUMBERS) {
                    await sendWhatsApp(phoneId, adminPhone, `${alertType}\n🕒 ${timeString}\nOrder ID: ${uniqueCode}\nFrom: +${customerPhone}\n\n${adminMessageContent}`);
                }
            }
            
        } else if (message?.type === 'image') {
            const messageId = message.id;
            if (processedMessages.has(messageId)) return; 
            processedMessages.add(messageId);
            if (processedMessages.size > 1000) processedMessages.clear();

            const msgTimestamp = parseInt(message.timestamp, 10);
            const currentTimestamp = Math.floor(Date.now() / 1000);
            if (currentTimestamp - msgTimestamp > 300) return;

            const customerPhone = message.from;
            const mediaId = message.image.id;
            const phoneId = value.metadata.phone_number_id;

            console.log(`📸 [Webhook] Image receipt received from +${customerPhone}`);
            await sendWhatsApp(phoneId, customerPhone, "Receipt received! 🧾 I am sending this to our human manager to verify right now. I will message you back the second your order is confirmed! ⏳");

            const uniqueCode = getOrderCode(customerPhone); 
            const timeString = new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
            
            for (const adminPhone of ADMIN_NUMBERS) {
                try {
                    await axios({
                        method: 'POST',
                        url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
                        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
                        data: { messaging_product: 'whatsapp', to: adminPhone, type: 'image', image: { id: mediaId } },
                    });
                    await sendWhatsApp(phoneId, adminPhone, `🚨 RECEIPT ALERT 🚨\n🕒 ${timeString}\nOrder ID: ${uniqueCode}\n\nJust tell me: "Confirm ${uniqueCode}"`);
                } catch (err) {
                    console.error(`❌ [WhatsApp Error] Failed to send receipt to +${adminPhone}:`, err.response ? JSON.stringify(err.response.data) : err.message);
                }
            }
        } else if (message?.type === 'audio') {
            console.log(`🎧 [Webhook] Voice note received from +${message.from}`);
            await sendWhatsApp(value.metadata.phone_number_id, message.from, "Hey! 🎧 I'm still learning how to listen to voice notes. Could you please type your order or question out for me? ✍️");
        }
    } 
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 [Server] ${BUSINESS_NAME} Bot server is running on port ${PORT}`);
});
