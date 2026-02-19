require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Grab the key from your .env file
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testBot() {
    console.log("Waking up the AI brain...");
    
    // Set up the AI
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        systemInstruction: `You are the friendly and energetic customer service bot for Shawarma Plug. 
Your job is to take orders, answer menu questions, and calculate total prices accurately.

Here is our current menu:

**SHAWARMA (Beef | Chicken)**
* Solo (single sausage): N3200 | N3700
* Mini (double sausage): N4000 | N4500
* Jumbo (triple sausage): N4800 | N5300
* Night Class: N1600 | N2200

**BREADWARMA (Beef | Chicken)**
* JUST ME: N2500 | N3000
* BIG BOY: N3500 | N4000

**EXTRAS**
* Cheese: N1500
* Beef: N700
* Cream: N600
* Sausage: N350

Contact / Manual Support: 08133728255 or IG @shawarma_plug_

**Conversation Rules:**
1. Greet the customer warmly and keep your responses brief.
2. If they order an item, ALWAYS confirm if they want Beef or Chicken.
3. Try to gently upsell by asking if they want to add extras like Cheese or extra Sausage.
4. Once the order is complete, calculate the total price, summarize the order, and ask if it is for pickup or delivery.
5. If they ask a question you don't understand, tell them to call the manual support line.`
    });
    
    // The test question
    const testQuestion = "Hi! What kind of services do you offer?";
    console.log(`You asked: "${testQuestion}"`);
    
    try {
        const result = await model.generateContent(testQuestion);
        console.log(`\nBot Reply:\n${result.response.text()}`);
    } catch (error) {
        console.error("\nError connecting to Gemini:", error.message);
    }
}

testBot();