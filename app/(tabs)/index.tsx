import { View, Text, StyleSheet } from 'react-native';

/**
 * Native shell home: full chat is in the web app. This tab keeps the Expo
 * bundle focused on auth + profile (comms-only).
 */
export default function HomeTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Blyve</Text>
      <Text style={styles.body}>
        Chats, friends, and groups are available in the web app. Use Profile and Settings here to manage your account.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    lineHeight: 22,
  },
});
