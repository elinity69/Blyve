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

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  /** Returns the email to use for sign-in, resolving a username if needed. */
  const resolveEmail = async (raw: string): Promise<string> => {
    const isEmail = raw.includes('@');
    if (isEmail) return raw;

    // Username lookup via security-definer RPC (readable by anon role).
    const { data, error: rpcError } = await supabase.rpc('get_email_by_username', {
      p_username: raw,
    });
    if (rpcError || !data) {
      throw new Error('No account found for that username');
    }
    return data as string;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const cleanIdentifier = identifier.trim();
    const cleanPassword = password.trim();

    if (!cleanIdentifier || !cleanPassword) {
      setError('Email (or username) and password are required');
      setLoading(false);
      return;
    }

    try {
      // For sign-up always expect an email; username resolution only applies to sign-in.
      const cleanEmail = isSignup ? cleanIdentifier : await resolveEmail(cleanIdentifier);

      if (isSignup) {
        const result = await api.signup({
          email: cleanEmail,
          password: cleanPassword,
          name: '',
        });

        if (result.accessToken) {
          api.setAccessToken(result.accessToken);
        } else {
          // No session yet (e.g. email confirmation required) — sign in explicitly
          await api.signin(cleanEmail, cleanPassword);
          const { data: supabaseSession, error: supabaseError } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: cleanPassword,
          });
          if (supabaseError || !supabaseSession?.session) {
            throw new Error(supabaseError?.message || 'Signup succeeded but sign-in failed');
          }
          api.setAccessToken(supabaseSession.session.access_token);
        }
      } else {
        await api.signin(cleanEmail, cleanPassword);

        const { data: supabaseSession, error: supabaseError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });

        if (supabaseError || !supabaseSession?.session) {
          throw new Error(`Failed to establish session: ${supabaseError?.message || 'No session returned'}`);
        }

        api.setAccessToken(supabaseSession.session.access_token);
      }

      onAuthSuccess();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-blyve via-blyve to-blyve-hover dark:from-black dark:via-black dark:to-black flex items-center justify-center p-4">
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
            <Label htmlFor="identifier">{isSignup ? 'Email' : 'Email or username'}</Label>
            <Input
              id="identifier"
              type={isSignup ? 'email' : 'text'}
              placeholder={isSignup ? 'you@example.com' : 'you@example.com or username'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete={isSignup ? 'email' : 'username'}
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
            <div className="border border-blyve/25 bg-blyve/10 text-gray-700 dark:text-gray-200 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-blyve hover:bg-blyve-hover h-12 text-lg"
            disabled={loading}
          >
            {loading ? 'Loading...' : isSignup ? 'Create Account' : 'Sign In'}
          </Button>
        </form>

        {!isSignup && (
          <div className="mt-4">
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
