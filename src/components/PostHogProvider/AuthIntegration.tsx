
import { useEffect, useRef } from 'react';
import { supabase } from '../../integrations/supabase/client';
import { identifyUser, setUserType, setSubscriptionPlan, resetIdentity } from '../../utils/posthog/simple';
import posthog from 'posthog-js';
import { logger } from '../../utils/posthog/logger';

interface AuthIntegrationProps {
  posthogLoadedRef: React.MutableRefObject<boolean>;
  currentUserRef: React.MutableRefObject<string | null>;
  updateUserType: (isKid: boolean) => void;
  updateSubscription: (planName: string, planId: string, planPrice: string) => void;
  setCurrentSubscriptionName: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentSubscription: React.Dispatch<React.SetStateAction<string | null>>;
}

export const useAuthIntegration = ({
  posthogLoadedRef,
  currentUserRef,
  updateUserType,
  updateSubscription,
  setCurrentSubscriptionName,
  setCurrentSubscription
}: AuthIntegrationProps) => {
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    if (posthogLoadedRef.current) {
      console.log('PostHog: Auth integration starting - checking current user');
      logger.debug('auth.integration.started');
      checkAndIdentifyCurrentUser();
    }
    
    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('PostHog: Auth state changed:', event);
      logger.debug('auth.state_changed', { event });

      if (event === 'SIGNED_IN' && session?.user && posthogLoadedRef.current) {
        console.log('PostHog: User signed in, identifying immediately');
        logger.debug('auth.signed_in');
        const email = session.user.email;
        if (email) {
          // Reset if different user
          if (currentUserRef.current && currentUserRef.current !== email) {
            console.log(`PostHog: Different user detected, resetting: ${email}`);
            resetIdentity();
          }
          
          // Identify user immediately on sign in
          identifyUserWithProfile(email, session.user.id, session.user.user_metadata);
        }
      } else if (event === 'SIGNED_OUT') {
        console.log('PostHog: User signed out, resetting identity');
        logger.debug('auth.signed_out');
        resetIdentity();
        currentUserRef.current = null;
      }
    });
    
    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [posthogLoadedRef.current]);

  const checkAndIdentifyCurrentUser = () => {
    if (!isMountedRef.current) return;
    
    supabase.auth.getSession().then(({ data }) => {
      if (!isMountedRef.current) return;
      
      if (data.session?.user) {
        const user = data.session.user;
        const email = user.email;
        
        if (email) {
          console.log(`PostHog: Found authenticated user: ${email}`);
          
          // Reset if different user
          if (currentUserRef.current && currentUserRef.current !== email) {
            console.log(`PostHog: Different user detected, resetting: ${email}`);
            resetIdentity();
          }
          
          // Simple identification using new utilities
          identifyUserWithProfile(email, user.id, user.user_metadata);
        }
      } else {
        console.log('PostHog: No authenticated user found');
      }
    }).catch(err => {
      console.error('Error checking session:', err);
    });
  };

  const identifyUserWithProfile = (email: string, userId: string, metadata?: any) => {
    if (!posthogLoadedRef.current || !isMountedRef.current) return;

    console.log(`PostHog: Identifying user with profile data: ${email}`);
    currentUserRef.current = email;
    
    // Fetch profile and identify
    supabase
      .from('profiles')
      .select('is_admin, admin_override, created_at, name, language, is_kids')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data: profileData, error }) => {
        if (!isMountedRef.current) return;
        
        if (error) {
          console.warn('PostHog: Profile fetch error:', error);
          logger.warn('auth.profile_fetch_error', { error: error.message });
        }
        
        // Create user properties
        const userProperties = {
          name: profileData?.name || metadata?.name || email?.split('@')[0],
          is_kids_account: profileData?.is_kids || false,
          language: profileData?.language || 'English',
          is_admin_user: profileData?.admin_override || profileData?.is_admin || false,
          email: email,
          supabase_id: userId,
          $set_once: { first_seen: new Date().toISOString() }
        };
        
        // Simple identification using new utilities
        console.log('PostHog: Identifying user with properties:', userProperties);
        logger.debug('auth.user_identified', {
          has_profile: !error,
          is_kids_account: userProperties.is_kids_account,
          is_admin: userProperties.is_admin_user,
          language: userProperties.language,
        });
        identifyUser(email, userProperties);
        
        // Reload feature flags after identification with proper timing
        console.log('PostHog: Reloading feature flags after user identification');
        setTimeout(() => {
          if (posthog && typeof posthog.reloadFeatureFlags === 'function') {
            posthog.reloadFeatureFlags();
            console.log('PostHog: Feature flags reloaded successfully');
            logger.debug('auth.feature_flags_reloaded');
          }
        }, 100);
        
        // Set user type
        const isKid = profileData?.is_kids === true;
        console.log(`PostHog: Setting user type - isKid: ${isKid}`);
        setUserType(isKid);
        updateUserType(isKid);
        
        // Handle subscription if present
        if (metadata?.selectedPlanId) {
          console.log(`PostHog: Processing subscription: ${metadata.selectedPlanId}`);
          fetchAndSetSubscription(metadata.selectedPlanId);
        }
      });
  };
  
  const fetchAndSetSubscription = (planId: string) => {
    if (!isMountedRef.current) return;
    
    supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .single()
      .then(({ data: planData, error }) => {
        if (!isMountedRef.current || error || !planData) {
          if (error) console.warn('PostHog: Subscription plan fetch error:', error);
          return;
        }
        
        const planName = planData.name;
        console.log(`PostHog: Setting subscription plan: ${planName}`);
        logger.debug('auth.subscription_set', { plan_name: planName, plan_id: planId, plan_price: planData.price || '0' });
        
        setCurrentSubscriptionName(planName);
        updateSubscription(planName, planId, planData.price || '0');
        setCurrentSubscription(planName);
        
        // Simple subscription identification using new utilities
        setSubscriptionPlan(planName, planId, planData.price);
      });
  };

  return { checkAndIdentifyCurrentUser };
};
