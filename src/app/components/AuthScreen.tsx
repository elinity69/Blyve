import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

export function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const handleSocialLogin = async (provider: 'google' | 'apple') => {
    setLoading(true);
    setError('');
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oauthError) throw oauthError;
    } catch (err: any) {
      console.error('OAuth login failed:', err);
      setError(err.message || 'Social login failed. Please try again.');
      setLoading(false);
    }
  };
  
  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleDemoLogin = async () => {
    setEmail('demo@blyve.com');
    setPassword('demo123456');
    setLoading(true);
    setError('');

    console.log('=== DEMO LOGIN STARTED ===');

    try {
      // Try to sign in with demo account
      try {
        console.log('Attempting to sign in with existing demo account...');
        const signInResult = await api.signin('demo@blyve.com', 'demo123456');
        console.log('✅ Demo login successful:', signInResult);
        console.log('Access token received:', signInResult.accessToken ? 'Yes' : 'No');
        
        // Also sign in to Supabase directly for direct queries
        try {
          const { data: supabaseSession, error: supabaseError } = await supabase.auth.signInWithPassword({
            email: 'demo@blyve.com',
            password: 'demo123456',
          });
          if (supabaseError) {
            console.warn('Supabase direct login failed (non-critical):', supabaseError);
          } else {
            console.log('✅ Supabase session established for direct queries');
          }
        } catch (supabaseErr) {
          console.warn('Could not establish Supabase session (non-critical):', supabaseErr);
        }
        
        // Small delay to ensure token is fully set
        await new Promise(resolve => setTimeout(resolve, 100));
        
        onAuthSuccess();
        return;
      } catch (signInError) {
        // If demo account doesn't exist, create it
        console.log('Demo account not found, creating new demo account...');
        console.log('Sign in error was:', signInError);
        
        await api.signup({
          email: 'demo@blyve.com',
          password: 'demo123456',
          name: 'Demo User',
        });
        
        console.log('Demo account created successfully, now signing in...');
        // Now sign in
        const signInResult = await api.signin('demo@blyve.com', 'demo123456');
        console.log('✅ Demo login successful after signup:', signInResult);
        console.log('Access token received:', signInResult.accessToken ? 'Yes' : 'No');
        
        // Also sign in to Supabase directly for direct queries
        try {
          const { data: supabaseSession, error: supabaseError } = await supabase.auth.signInWithPassword({
            email: 'demo@blyve.com',
            password: 'demo123456',
          });
          if (supabaseError) {
            console.warn('Supabase direct login failed (non-critical):', supabaseError);
          } else {
            console.log('✅ Supabase session established for direct queries');
          }
        } catch (supabaseErr) {
          console.warn('Could not establish Supabase session (non-critical):', supabaseErr);
        }
        
        // Small delay to ensure token is fully set
        await new Promise(resolve => setTimeout(resolve, 100));
        
        onAuthSuccess();
      }
    } catch (err: any) {
      console.error('❌ Demo login failed:', err);
      setError(err.message || 'Demo login failed. Please try manual signup.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Trim email and password to remove any whitespace
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    // Validate that email and password are not empty after trimming
    if (!cleanEmail || !cleanPassword) {
      setError('Email and password are required');
      setLoading(false);
      return;
    }

    try {
      if (isSignup) {
        await api.signup({
          email: cleanEmail,
          password: cleanPassword,
          name: '',
        });
        
        // Auto-signin after signup
        await api.signin(cleanEmail, cleanPassword);
      } else {
        await api.signin(cleanEmail, cleanPassword);
      }
      
      // CRITICAL: Wait for Supabase session to be fully established before proceeding
        const { data: supabaseSession, error: supabaseError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });
      
      if (supabaseError || !supabaseSession?.session) {
        throw new Error(`Failed to establish session: ${supabaseError?.message || 'No session returned'}`);
      }
      
      console.log('✅ Supabase session established');
      
      // Wait a bit for session to propagate through the app
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Verify session is still valid before proceeding
      const { data: { session: verifySession } } = await supabase.auth.getSession();
      if (!verifySession?.access_token) {
        throw new Error('Session verification failed - session not persisted');
      }
      
      console.log('✅ Session verified, proceeding to app');
      
      onAuthSuccess();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-orange-500 via-pink-500 to-purple-600 dark:from-black dark:via-black dark:to-black flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0A0A0A] dark:border dark:border-white/5 rounded-3xl p-8 max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-center mb-6">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
            Blyve
          </h1>
        </div>

        <p className="text-center text-gray-600 dark:text-gray-300 mb-8">
          {isSignup ? 'Create your account to join Blyve' : 'Welcome back! Sign in to continue'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
          <div className="relative z-10">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="relative z-10"
              style={{ pointerEvents: 'auto' }}
            />
          </div>

          <div className="relative z-10">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="relative z-10"
              style={{ pointerEvents: 'auto' }}
            />
          </div>

          {error && (
            <div className="bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 border border-purple-200 bg-gradient-to-br from-purple-600 via-pink-600 to-rose-600 bg-clip-text text-transparent px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-orange-600 to-pink-600 hover:from-orange-700 hover:to-pink-700 h-12 text-lg"
            disabled={loading}
          >
            {loading ? 'Loading...' : isSignup ? 'Create Account' : 'Sign In'}
          </Button>
        </form>

        {!isSignup && (
          <div className="mt-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-white/5"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-[#0A0A0A] text-gray-500 dark:text-gray-400">Or</span>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSocialLogin('apple')}
                disabled={loading}
                className="w-full border-2 border-gray-300 dark:border-white/5 text-gray-700 dark:text-gray-200 h-12 font-semibold hover:bg-gray-50 dark:hover:bg-[#0A0A0A]/80"
              >
                🍎 Continue with Apple
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSocialLogin('google')}
                disabled={loading}
                className="w-full border-2 border-gray-300 dark:border-white/5 text-gray-700 dark:text-gray-200 h-12 font-semibold hover:bg-gray-50 dark:hover:bg-[#0A0A0A]/80"
              >
                🔍 Continue with Google
              </Button>
            </div>

            <Button
              type="button"
              onClick={handleDemoLogin}
              disabled={loading}
              variant="outline"
              className="w-full mt-4 border-2 border-orange-300 bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 bg-clip-text text-transparent hover:bg-gradient-to-br hover:from-orange-50 hover:via-pink-50 hover:to-red-50 h-12"
            >
              🚀 Try Demo Account
            </Button>
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsSignup(!isSignup);
              setError('');
            }}
            className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
}