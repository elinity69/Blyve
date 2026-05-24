import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';

export default function Index() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Checking authentication...');

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      setStatus('Checking authentication...');
      
      // Quick check if user is already logged in (with timeout)
      const timeout = setTimeout(() => {
        console.log('Auth check timeout, going to auth screen...');
        router.replace('/(auth)');
      }, 2000);
      
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        clearTimeout(timeout);
        
        if (authError) {
          console.log('Auth error:', authError.message);
          router.replace('/(auth)');
          return;
        }
        
        if (user) {
          // User is authenticated, go to main app
          console.log('✅ User already authenticated:', user.email);
          router.replace('/(tabs)');
          return;
        }
        
        // No user found - go directly to auth screen
        console.log('No user found, going to auth screen...');
        router.replace('/(auth)');
      } catch (error: any) {
        clearTimeout(timeout);
        console.error('Auth check error:', error);
        setError(error?.message || 'Connection error');
        // Go to auth screen on any error
        setTimeout(() => {
          router.replace('/(auth)');
        }, 1000);
      }
    } catch (error: any) {
      console.error('Fatal error:', error);
      setError(error?.message || 'Unknown error');
      // Go to auth screen on any error
      setTimeout(() => {
        router.replace('/(auth)');
      }, 1000);
    }
  };

  // Show loading screen while checking auth
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#FF6B35" />
      <Text style={styles.statusText}>{status}</Text>
      {error && (
        <Text style={styles.errorText}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  statusText: {
    marginTop: 16,
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  errorText: {
    marginTop: 16,
    color: '#ff0000',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

