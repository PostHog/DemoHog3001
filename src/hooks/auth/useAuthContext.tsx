import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../../integrations/supabase/client';
import { safeReset } from '../../utils/posthog';
import { logger } from '../../utils/posthog/logger';

// Define types for our auth context
export interface AuthState {
  isLoggedIn: boolean;
  userName: string;
  avatarUrl: string;
  userEmail: string;
  isLoading: boolean;
  userMetadata?: Record<string, any>;
  user?: {
    id: string;
  };
}

interface AuthContextType extends AuthState {
  handleLogout: () => Promise<void>;
  fetchUserProfile: (userId: string) => Promise<void>;
}

const initialAuthState: AuthState = {
  isLoggedIn: false,
  userName: '',
  avatarUrl: '',
  userEmail: '',
  isLoading: true,
  userMetadata: {},
  user: undefined
};

// Create context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Comprehensive cleanup function for all auth-related data
const cleanupAllAuthData = () => {
  try {
    console.log('Starting comprehensive auth data cleanup...');
    
    // Get all localStorage keys to clean up
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('supabase.auth.') ||
        key.includes('sb-') ||
        key.startsWith('posthog_') ||
        key === 'ph_last_auth_check' ||
        key === 'posthog_email_cache' ||
        key === 'posthog_last_identified_user' ||
        key === 'posthog_last_groups'
      )) {
        keysToRemove.push(key);
      }
    }
    
    // Remove all auth-related keys
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      console.log(`Removed localStorage key: ${key}`);
    });
    
    // Also clear sessionStorage if used
    const sessionKeysToRemove = [];
    if (typeof sessionStorage !== 'undefined') {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (
          key.startsWith('supabase.auth.') ||
          key.includes('sb-') ||
          key.startsWith('posthog_')
        )) {
          sessionKeysToRemove.push(key);
        }
      }
      sessionKeysToRemove.forEach(key => {
        sessionStorage.removeItem(key);
        console.log(`Removed sessionStorage key: ${key}`);
      });
    }
    
    console.log('Auth data cleanup completed');
  } catch (error) {
    console.error('Error during auth data cleanup:', error);
  }
};

// Auth provider component
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>(initialAuthState);
  const authSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const processedSessionsRef = useRef(new Set<string>());
  const isInitializedRef = useRef(false);

  // Update auth state
  const updateAuthState = (newState: Partial<AuthState>) => {
    setAuthState(prevState => ({ ...prevState, ...newState }));
  };

  // Process profile data
  const fetchUserProfile = async (userId: string) => {
    console.log("Fetching profile for user:", userId);
    
    try {
      // Get user info with metadata
      const { data: userData } = await supabase.auth.getUser();
      const userMetadata = userData?.user?.user_metadata || {};
      
      // Query the profiles table
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;

      if (profileData) {
        updateAuthState({
          userName: profileData.name || 'User',
          avatarUrl: profileData.avatar_url || '',
          userMetadata: userMetadata,
          user: { id: userId },
          isLoading: false
        });
      } else {
        // Get user info to create a default profile
        if (userData?.user) {
          const email = userData.user.email || '';
          const name = userData.user.user_metadata?.name || email.split('@')[0];
          
          updateAuthState({
            userName: name,
            userMetadata: userMetadata,
            user: { id: userId },
            isLoading: false
          });
        }
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      updateAuthState({ isLoading: false });
    }
  };

  // Enhanced logout with comprehensive cleanup
  const handleLogout = async () => {
    try {
      console.log('Starting logout process...');

      // Step 1: Clean up all cached data first
      cleanupAllAuthData();
      
      // Step 2: Reset PostHog identity
      console.log('Resetting PostHog identity...');
      safeReset();
      
      // Step 3: Sign out from Supabase with global scope
      console.log('Signing out from Supabase...');
      try {
        await supabase.auth.signOut({ scope: 'global' });
      } catch (supabaseError) {
        console.warn('Supabase signOut error (continuing anyway):', supabaseError);
      }
      
      // Step 4: Reset auth state
      console.log('Resetting auth state...');
      updateAuthState({
        ...initialAuthState,
        isLoading: false
      });
      
      // Step 5: Clear processed sessions
      processedSessionsRef.current.clear();
      
      console.log('Logout process completed successfully');
      // Wide event: one log at completion
      logger.info('auth.logout.completed', { status: 'success' });
      
      // Step 6: Force a clean page reload to ensure all state is reset
      setTimeout(() => {
        window.location.href = '/';
      }, 100);
      
    } catch (error: any) {
      console.error("Error during logout:", error);
      // Wide event: one log at completion with failure context
      logger.error('auth.logout.completed', { status: 'failure', error: error?.message || 'unknown' });
      
      // Even if there's an error, try to reset the state and reload
      updateAuthState({
        ...initialAuthState,
        isLoading: false
      });
      
      // Still force reload to ensure clean state
      setTimeout(() => {
        window.location.href = '/';
      }, 100);
    }
  };

  // Initialize auth state and set up listeners
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;
    
    const initializeAuth = async () => {
      try {
        // First check for existing session
        const { data: sessionData } = await supabase.auth.getSession();
        
        if (sessionData?.session?.user) {
          const user = sessionData.session.user;
          const sessionKey = `${user.id}_${Date.now()}`;
          processedSessionsRef.current.add(sessionKey);
          
          // Update with basic info immediately
          updateAuthState({
            isLoggedIn: true,
            userEmail: user.email || '',
            userMetadata: user.user_metadata || {},
            user: { id: user.id }, // Add the user id
            isLoading: false
          });
          
          // Fetch profile data 
          fetchUserProfile(user.id);
        } else {
          // No session found
          updateAuthState({
            isLoggedIn: false,
            isLoading: false
          });
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
        updateAuthState({ isLoading: false });
      }
    };
    
    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) {
        if (session?.user) {
          const user = session.user;
          const sessionKey = `${user.id}_${event}_${Date.now()}`;
          
          // Skip if we already processed this session
          if (processedSessionsRef.current.has(sessionKey)) return;
          processedSessionsRef.current.add(sessionKey);
          
          console.log(`Auth event: ${event}`, user.email);
          
          // Update with basic info immediately
          updateAuthState({
            isLoggedIn: true,
            userEmail: user.email || '',
            userMetadata: user.user_metadata || {},
            user: { id: user.id }, // Add the user id
            isLoading: false
          });
          
          // Fetch profile data in next tick to avoid Supabase deadlock
          setTimeout(() => fetchUserProfile(user.id), 0);
        } else if (event === 'SIGNED_OUT') {
          updateAuthState({
            isLoggedIn: false,
            userName: '',
            avatarUrl: '',
            userEmail: '',
            userMetadata: {},
            user: undefined, // Clear the user object
            isLoading: false
          });
        }
      }
    });
    
    authSubscriptionRef.current = subscription;
    
    // Initialize auth
    initializeAuth();
    
    // Cleanup
    return () => {
      if (authSubscriptionRef.current) {
        authSubscriptionRef.current.unsubscribe();
      }
    };
  }, []);

  return (
    <AuthContext.Provider value={{
      ...authState,
      handleLogout,
      fetchUserProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// Hook to use auth context
export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};
