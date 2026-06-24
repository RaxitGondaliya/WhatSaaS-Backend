# WhatSaaS Backend

Backend API for WhatSaaS — a WhatsApp SaaS CRM platform built to manage businesses, contacts, requests, chatbot flows, broadcasts, analytics, reports, notifications, and team members.

## Features

* JWT Authentication
* Google Login
* Forgot Password (OTP)
* Business Setup
* Team Member Management
* Contacts Management
* Request Management
* Chatbot Flow Management
* Broadcast Campaign Management
* Analytics & Finance APIs
* Reports Center APIs
* Dashboard APIs
* Notification System

## Tech Stack

* Node.js
* Express.js
* MongoDB
* Mongoose
* JWT
* Nodemailer

## Installation

Clone the repository:

```bash
git clone <repository-url>
```

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```env
PORT=5000
MONGO_URI=your_mongodb_connection
JWT_SECRET=your_jwt_secret

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_password
```

Start development server:

```bash
npm run dev
```

Server runs on:

```text
http://localhost:5000
```

## API Modules

```text
/api/auth
/api/business
/api/team-members
/api/contacts
/api/requests
/api/dashboard
/api/analytics
/api/reports
/api/chatbot-flows
/api/broadcast-campaigns
/api/notifications
```

## Project Structure

```text
src/
├── config/
├── controllers/
├── middleware/
├── models/
├── routes/
├── utils/
└── app.js
```

## Current Status

### Completed

* Authentication
* Business Setup
* Contacts
* Requests
* Chatbot Flows
* Broadcast Campaigns
* Analytics
* Reports
* Notifications
* Team Management

### Planned

* Wallet Module
* Templates Module
* WhatsApp Meta Integration
* Real Broadcast Delivery
* Export Reports (PDF/Excel)

## Author

Raxit Gondaliya
