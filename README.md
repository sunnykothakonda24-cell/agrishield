# 🌱 AgriShield AI

AgriShield AI is an AI-powered agriculture platform designed to help farmers make better farming decisions using AI, weather data, farm information, and crop-specific guidance.

## 🚜 What AgriShield AI Does

AgriShield AI helps farmers with:

- 🤖 AI-powered farming assistance
- 🌾 Crop-specific guidance
- 🌦️ Weather and rainfall information
- 🗺️ Farm location and boundary management
- 🌱 Farm and crop profiles
- 📅 Crop growth and farming schedules
- 🏡 Farm Twin visualization
- 🛒 Seeds and fertilizer information
- 🔔 Farming alerts and notifications
- 🎤 Voice-based interaction
- 🌐 English, Hindi, and Telugu support
- 📷 Crop image analysis

## 🧠 AI Assistant

The AgriShield AI assistant allows farmers to ask questions naturally instead of selecting only predefined questions.

Farmers can interact using:

- Text
- Voice
- Crop images
- English
- Hindi
- Telugu

The application uses Google's Gemini AI services for AI-powered responses.

## 🌦️ Weather

AgriShield AI uses Open-Meteo to provide weather information based on the farmer's saved farm location.

The system can provide:

- Current weather
- Forecast
- Rain probability
- Rain analysis
- Farm-specific weather information

## 🗺️ Farm Management

Farmers can create and manage multiple farms.

Each farm can contain:

- Farm name
- Location
- GPS coordinates
- Boundary
- Area
- Perimeter
- Length and width
- Crop
- Soil information
- Water source
- Farm Twin information
- Weather information

Farm-specific information is isolated using the authenticated Firebase user ID and farm ID.

## 🏡 Farm Twin

Farm Twin provides a digital representation of the farmer's land using available farm information such as:

- Farm boundary
- Farm dimensions
- Location
- Crop information
- Soil information
- Water source
- Weather conditions

## 🛒 Shop

The Shop section provides information about:

- Seeds
- Fertilizers

AgriShield AI does not directly sell pesticides or agricultural products.

Where applicable, farmers can view authorized seller or broker contact information and contact them directly.

## 🔐 Authentication

AgriShield AI uses Firebase Authentication with:

- Email and password registration
- Email and password login
- Password reset
- Firebase ID token authentication

The backend verifies Firebase ID tokens before accessing protected application data.

## 🗄️ Database

AgriShield AI uses Firebase Firestore for application data.

The architecture separates authentication from application data:

```text
Farmer
   ↓
React Frontend
   ↓
Firebase Authentication
   ↓
Firebase ID Token
   ↓
Node.js / Express Backend
   ↓
Firebase Admin SDK
   ↓
Firestore
