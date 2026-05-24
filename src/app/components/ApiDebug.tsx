import { useState } from 'react';
import { projectId } from '../../../utils/supabase/info';
import { supabase } from '../lib/supabase';

export function ApiDebug() {
  const [testResult, setTestResult] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const testSupabaseConnection = async () => {
    setTesting(true);
    setTestResult('Testing...');
    
    try {
      console.log('Testing Supabase connection...');
      console.log('Project ID:', projectId);

      // Test 1: Check auth session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log('Session check:', session ? '✅ Has session' : '❌ No session', sessionError);

      // Test 2: Try to query profiles table using count (more efficient)
      const { count, error: countError } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      if (countError) {
        console.error('Profiles count error:', countError);
        setTestResult(`❌ Supabase Error: ${countError.message}`);
      } else {
        console.log('✅ Supabase connected! Profiles count successful');
        setTestResult(`✅ Supabase Connected! (Found ${count || 0} profiles in database)`);
      }
    } catch (error) {
      console.error('Connection error:', error);
      setTestResult(`❌ Connection Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed bottom-20 right-4 bg-white dark:bg-slate-800 border-2 border-orange-500 rounded-lg p-4 shadow-lg max-w-sm z-50">
      <h3 className="font-bold mb-2 text-sm text-gray-900 dark:text-white">Supabase Debug Panel</h3>
      <div className="text-xs mb-2 space-y-1 text-gray-600 dark:text-gray-300">
        <div><strong>Project:</strong> {projectId}</div>
        <div><strong>Method:</strong> Direct Supabase SDK</div>
      </div>
      <button
        onClick={testSupabaseConnection}
        disabled={testing}
        className="w-full bg-orange-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-orange-700 disabled:opacity-50 mb-2"
      >
        {testing ? 'Testing...' : 'Test Supabase Connection'}
      </button>
      {testResult && (
        <div className={`text-xs p-2 rounded ${
          testResult.startsWith('✅') ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
        }`}>
          {testResult}
        </div>
      )}
    </div>
  );
}
