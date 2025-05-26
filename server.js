const express = require('express');
const session = require('cookie-session');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());

// Allow requests from your frontend domain
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));

// Session configuration
app.use(session({
  name: 'session',
  keys: ['key1', 'key2'],
  maxAge: 24 * 60 * 60 * 1000 // 1 day
}));

// Root route for testing Render deployment
app.get('/', (req, res) => {
  res.send('✅ Backend is up and running!');
});

// OAuth2 client setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Step 1: Redirect to Google OAuth
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  res.redirect(authUrl);
});

// Step 2: Handle callback from Google
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = tokens;
    res.redirect(process.env.FRONTEND_URL); // Back to your static site
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed.');
  }
});

// Step 3: Create a Google Meet via Calendar API
app.post('/api/create-google-meet', async (req, res) => {
  if (!req.session.tokens) return res.status(401).send('Not authenticated');

  try {
    oauth2Client.setCredentials(req.session.tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 30 * 60000); // +30 min

    const event = {
      summary: 'Mentorship Session',
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        }
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1
    });

    res.json({ meetLink: response.data.hangoutLink });
  } catch (error) {
    console.error('Failed to create Meet:', error);
    res.status(500).send('Failed to create Google Meet.');
  }
});

// Start the server
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

