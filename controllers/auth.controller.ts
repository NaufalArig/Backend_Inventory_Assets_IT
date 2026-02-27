import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import emailService from '../services/email.service';

interface User extends RowDataPacket {
  id: number;
  email: string;
  password: string;
  name: string;
  role: string;
  phone: string;
  status: string;
  email_verified: boolean;
}

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, department } = req.body;

    // Validasi input
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    // Check if user exists
    const [existingUsers] = await pool.query<User[]>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification token
    const verificationToken = emailService.generateVerificationToken();
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Insert user with email_verified = false
    const [result] = await pool.query(
      `INSERT INTO users (name, email, password, phone, department, email_verified, verification_token, token_expiry) 
       VALUES (?, ?, ?, ?, ?, false, ?, ?)`,
      [name, email, hashedPassword, phone, department, verificationToken, tokenExpiry]
    );

    const userId = (result as any).insertId;

    // Send verification email
    const emailSent = await emailService.sendVerificationEmail(email, name, verificationToken);

    if (!emailSent) {
      console.error('Failed to send verification email');
      // Tetap lanjutkan registrasi meskipun email gagal
    }

    // Log activity
    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'User registered', 'user', req.ip]
    );

    res.status(201).json({
      message: 'User registered successfully. Please check your email to verify your account.',
      userId: userId,
      emailSent: emailSent
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// PERBAIKAN: Ubah menjadi POST untuk menerima token dari body
export const verifyEmail = async (req: Request, res: Response) => {
  try {
    const { token } = req.body; // Sekarang mengambil dari body bukan query

    if (!token) {
      return res.status(400).json({ message: 'Verification token is required' });
    }

    console.log('Verifying token:', token);

    // Find user with matching token
    const [users] = await pool.query<User[]>(
      `SELECT id, name, email, email_verified, token_expiry 
       FROM users 
       WHERE verification_token = ? AND email_verified = false`,
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    const user = users[0];

    // Check if token is expired
    const tokenExpiry = new Date((user as any).token_expiry);
    if (tokenExpiry < new Date()) {
      return res.status(400).json({ message: 'Verification token has expired' });
    }

    // Update user as verified
    await pool.query(
      `UPDATE users 
       SET email_verified = true, verification_token = NULL, token_expiry = NULL, status = 'Active'
       WHERE id = ?`,
      [user.id]
    );

    // Send welcome email
    await emailService.sendWelcomeEmail(user.email, user.name);

    // Log activity
    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type) VALUES (?, ?, ?)',
      [user.id, 'Email verified', 'user']
    );

    res.json({ 
      message: 'Email verified successfully. You can now login to your account.',
      verified: true
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Alternatif: Tetap pertahankan GET method untuk compatibility
export const verifyEmailGet = async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'Invalid verification token' });
    }

    console.log('Verifying token (GET):', token);

    // Find user with matching token
    const [users] = await pool.query<User[]>(
      `SELECT id, name, email, email_verified, token_expiry 
       FROM users 
       WHERE verification_token = ? AND email_verified = false`,
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    const user = users[0];

    // Check if token is expired
    const tokenExpiry = new Date((user as any).token_expiry);
    if (tokenExpiry < new Date()) {
      return res.status(400).json({ message: 'Verification token has expired' });
    }

    // Update user as verified
    await pool.query(
      `UPDATE users 
       SET email_verified = true, verification_token = NULL, token_expiry = NULL, status = 'Active'
       WHERE id = ?`,
      [user.id]
    );

    // Send welcome email
    await emailService.sendWelcomeEmail(user.email, user.name);

    // Log activity
    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type) VALUES (?, ?, ?)',
      [user.id, 'Email verified', 'user']
    );

    res.json({ 
      message: 'Email verified successfully. You can now login to your account.',
      verified: true
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const resendVerification = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Find user
    const [users] = await pool.query<User[]>(
      'SELECT id, name, email, email_verified FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    if (user.email_verified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    // Generate new verification token
    const verificationToken = emailService.generateVerificationToken();
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Update token
    await pool.query(
      'UPDATE users SET verification_token = ?, token_expiry = ? WHERE id = ?',
      [verificationToken, tokenExpiry, user.id]
    );

    // Resend verification email
    const emailSent = await emailService.sendVerificationEmail(user.email, user.name, verificationToken);

    if (!emailSent) {
      return res.status(500).json({ message: 'Failed to send verification email' });
    }

    res.json({ message: 'Verification email has been resent. Please check your inbox.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Find user
    const [users] = await pool.query<User[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = users[0];

    // Check if email is verified
    if (!user.email_verified) {
      return res.status(403).json({ 
        message: 'Please verify your email before logging in',
        emailVerified: false,
        email: user.email // Kirim email untuk memudahkan resend verification
      });
    }

    // Check if user is active
    if (user.status !== 'Active') {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Log activity
    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type, ip_address) VALUES (?, ?, ?, ?)',
      [user.id, 'User logged in', 'user', req.ip]
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        department: user.department
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    // Log activity
    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type) VALUES (?, ?, ?)',
      [userId, 'User logged out', 'user']
    );

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Tambahkan endpoint untuk check verification status
export const checkVerificationStatus = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const [users] = await pool.query<User[]>(
      'SELECT id, email_verified FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    res.json({
      emailVerified: user.email_verified,
      message: user.email_verified ? 'Email is verified' : 'Email not verified'
    });
  } catch (error) {
    console.error('Check verification status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};