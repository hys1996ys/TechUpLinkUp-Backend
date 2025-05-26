const express = require('express');
const session = require('cookie-session');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());

// Allow requests from your frontend domain
const allowedOrigins = [
  'https://techuplinkup.com',
  'https://www.techuplinkup.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Session configuration
app.use(session({
  name: 'session',
  keys: ['key1', 'key2'],
  maxAge: 24 * 60 * 60 * 1000,
  sameSite: 'none',
  secure: true
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

const supabaseClient = require('@supabase/supabase-js').createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Step 3: Create a Google Meet via Calendar API
app.post('/api/create-google-meet', async (req, res) => {
  let userId = null;

  // Extract Supabase access token from Authorization header
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  // Validate Supabase token
  const { data: user, error } = await supabaseClient.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid Supabase token' });
  }

  // Now you're authenticated!
  oauth2Client.setCredentials(req.session.tokens); // or store OAuth tokens per user if needed

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 30 * 60000);

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create Meet' });
  }
});

// Add an endpoint to check Google OAuth authentication status
app.get('/api/check-auth', (req, res) => {
  if (req.session && req.session.tokens) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// Start the server
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

