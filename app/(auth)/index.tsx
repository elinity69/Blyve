import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
  useColorScheme,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Demo Account für Tests
  const handleDemoLogin = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'demo@test.com',
        password: 'demo123456',
      });

      if (error) throw error;

      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        // Profile wird automatisch durch Trigger erstellt (handle_new_user)
        // Falls es nicht automatisch erstellt wurde, warten wir kurz
        if (data.user) {
          // Warte kurz, damit Trigger ausführen kann
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Prüfe ob Profil existiert, falls nicht erstelle es manuell
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', data.user.id)
            .single();
            
          if (!existingProfile) {
            const { error: profileError } = await supabase
              .from('profiles')
              .insert({
                id: data.user.id,
                email: data.user.email,
                name: null,
                username: null,
                images: [`https://i.pravatar.cc/150?u=${data.user.id}`],
              });

            if (profileError) {
              console.warn('Profile creation error (may already exist):', profileError);
            }
          }
        }

        Alert.alert('Success', 'Account created! Please sign in.');
        setIsSignUp(false);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        router.replace('/(tabs)');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, isDark && styles.containerDark]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={[styles.title, isDark && styles.textLight]}>Blyve</Text>
        <Text style={[styles.subtitle, isDark && styles.textMutedLight]}>Friends, chats, and groups</Text>
        {isSignUp && (
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAcceptedLegal((prev) => !prev)}
          >
            <View style={[styles.checkbox, acceptedLegal && styles.checkboxChecked]} />
            <Text style={styles.checkboxText}>
              Ich akzeptiere die{' '}
              <Text
                style={styles.linkInline}
                onPress={() => Linking.openURL('https://meine-app.com/agb')}
              >
                AGB
              </Text>{' '}
              und{' '}
              <Text
                style={styles.linkInline}
                onPress={() => Linking.openURL('https://meine-app.com/datenschutz')}
              >
                Datenschutzerklärung
              </Text>
              .
            </Text>
          </TouchableOpacity>
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[
            styles.button,
            isSignUp && !acceptedLegal ? styles.buttonDisabled : null,
          ]}
          onPress={handleAuth}
          disabled={loading || (isSignUp && !acceptedLegal)}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </Text>
          )}
        </TouchableOpacity>

        {!isSignUp && (
          <View style={styles.socialContainer}>
            <TouchableOpacity style={[styles.socialButton, isDark && styles.socialButtonDark]}>
              <Text style={[styles.socialButtonText, isDark && styles.textLight]}>
                Continue with Apple
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.socialButton, isDark && styles.socialButtonDark]}>
              <Text style={[styles.socialButtonText, isDark && styles.textLight]}>
                Continue with Google
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => setIsSignUp(!isSignUp)}
        >
          <Text style={[styles.linkText, isDark && styles.textAccentLight]}>
            {isSignUp
              ? 'Already have an account? Sign In'
              : "Don't have an account? Sign Up"}
          </Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.button, styles.demoButton]}
          onPress={handleDemoLogin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Try Demo Account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => Linking.openURL('https://meine-app-url.vercel.app/?legal=1')}
        >
          <Text style={styles.linkText}>Impressum & Rechtliches</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  containerDark: {
    backgroundColor: '#0f172a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#FF6B35',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
    color: '#666',
  },
  textLight: {
    color: '#f8fafc',
  },
  textMutedLight: {
    color: '#cbd5f5',
  },
  textAccentLight: {
    color: '#ff9f7a',
  },
  banner: {
    backgroundColor: '#FFF3E9',
    borderWidth: 1,
    borderColor: '#FF6B35',
    padding: 10,
    borderRadius: 12,
    marginBottom: 20,
  },
  bannerText: {
    color: '#D35400',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  button: {
    backgroundColor: '#FF6B35',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#F5A08A',
  },
  demoButton: {
    backgroundColor: '#4CAF50',
    marginTop: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  socialContainer: {
    marginTop: 12,
    gap: 10,
  },
  socialButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  socialButtonDark: {
    borderColor: '#334155',
    backgroundColor: '#111827',
  },
  socialButtonText: {
    color: '#111',
    fontSize: 14,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  linkText: {
    color: '#FF6B35',
    fontSize: 14,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    marginRight: 10,
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#FF6B35',
    borderColor: '#FF6B35',
  },
  checkboxText: {
    flex: 1,
    color: '#666',
    fontSize: 12,
  },
  linkInline: {
    color: '#FF6B35',
    textDecorationLine: 'underline',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#999',
    fontSize: 14,
  },
});

