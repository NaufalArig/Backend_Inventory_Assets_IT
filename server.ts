import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';

// Import routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import assetRoutes from './routes/asset.routes';
import libraryRoutes from './routes/library.routes';
import dashboardRoutes from './routes/dashboard.routes';
import chatbotRoutes from './routes/chatbot.routes';
import uploadRoutes from './routes/upload.routes';
import settingsRoutes from './routes/settings.routes';
import borrowingRoutes from './routes/borrowing.routes';
import migrationRoutes from './routes/migration.routes';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logger middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`\n [${timestamp}]`);
  console.log(`   Method: ${req.method}`);
  console.log(`   Path: ${req.originalUrl}`);
  console.log(`   IP: ${req.ip}`);
  if (req.headers.authorization) {
    console.log(`   Auth: ${req.headers.authorization.substring(0, 20)}...`);
  }
  next();
});

app.use('/api/migration', (req, res, next) => {
  console.log(`Migration route: ${req.method} ${req.path}`);
  next();
}, migrationRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    routes: {
      auth: '/api/auth/*',
      users: '/api/users/*',
      assets: '/api/assets/*',
      library: '/api/library/*',
      dashboard: '/api/dashboard/*',
      chatbot: '/api/chatbot/*',
      upload: '/api/upload/*'
    }
  });
});

// API Routes
console.log('🔧 Registering routes...');

app.use('/api/auth', (req, res, next) => {
  console.log(`🔐 AUTH ROUTE ACCESSED: ${req.method} ${req.originalUrl}`);
  console.log(`   Time: ${new Date().toISOString()}`);
  next();
}, authRoutes);

app.use('/api/users', (req, res, next) => {
  console.log(`Users route: ${req.method} ${req.path}`);
  next();
}, userRoutes);

app.use('/api/assets', (req, res, next) => {
  console.log(`Assets route: ${req.method} ${req.path}`);
  next();
}, assetRoutes);

app.use('/api/library', (req, res, next) => {
  console.log(`Library route: ${req.method} ${req.path}`);
  next();
}, libraryRoutes);

app.use('/api/dashboard', (req, res, next) => {
  console.log(`Dashboard route: ${req.method} ${req.path}`);
  next();
}, dashboardRoutes);

app.use('/api/settings', (req, res, next) => {
  console.log(`Settings route: ${req.method} ${req.path}`);
  next();
}, settingsRoutes);

app.use('/api/borrowings', (req, res, next) => {
  console.log(`Borrowings route: ${req.method} ${req.path}`);
  next();
}, borrowingRoutes);

app.use('/api/chatbot', (req, res, next) => {
  console.log(`Chatbot route: ${req.method} ${req.path}`);
  next();
}, chatbotRoutes);

// NEW: Upload routes
app.use('/api/upload', (req, res, next) => {
  console.log(`Upload route: ${req.method} ${req.path}`);
  next();
}, uploadRoutes);

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Test route for debugging
app.get('/api/test', (req: Request, res: Response) => {
  res.json({ 
    message: 'API is working!',
    timestamp: new Date().toISOString(),
    gemini: process.env.GEMINI_API_KEY ? 'Configured' : 'Not configured'
  });
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  console.log(`\n 404 Not Found:`);
  console.log(`   Method: ${req.method}`);
  console.log(`   URL: ${req.originalUrl}`);
  
  res.status(404).json({ 
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    availableRoutes: [
      'GET /health',
      'GET /api/test',
      'GET /api/settings',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'POST /api/upload/assets',
      'GET /api/assets',
      'POST /api/assets',
      'GET /api/library',
      'POST /api/chatbot/message'
    ]
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log('\n Server started successfully!');
  console.log(`   Port: ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Gemini API: ${process.env.GEMINI_API_KEY ? 'Configured ' : 'Not configured '}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`\n Available routes:`);
  console.log(`   POST http://localhost:${PORT}/api/upload/assets (Upload files)`);
  console.log(`   GET  http://localhost:${PORT}/api/assets (Get all assets)`);
  console.log('\n Server is ready to accept requests!\n');
});

export default app;