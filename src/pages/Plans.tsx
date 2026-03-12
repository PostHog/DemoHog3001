
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { PlanFeatures } from '../components/plans/PlanFeatures';
import { SubscriptionPlansGrid } from '../components/plans/SubscriptionPlansGrid';
import { supabase } from '../integrations/supabase/client';
import { useToast } from '../hooks/use-toast';
import { Plan } from '../components/SubscriptionPlan';
import { safeCapture, captureEventWithGroup, captureTestEvent } from '../utils/posthog';
import { useFeatureFlagVariantKey } from 'posthog-js/react';
import { extractPriceValue } from '../utils/posthog/helpers';
import { logger } from '../utils/posthog/logger';

const Plans = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageLoadTime] = useState<Date>(new Date());
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // Get A/B test variant for analytics
  const ctaVariant = useFeatureFlagVariantKey('subscription_cta_test') as string | null;

  // Track page view with test variant information and funnel step
  useEffect(() => {
    captureTestEvent(
      'plans_page_viewed', 
      'subscription_cta_test',
      ctaVariant,
      {
        timestamp: new Date().toISOString(),
        funnel_step: 'view_plans',
        test_active: ctaVariant !== null
      }
    );
  }, [ctaVariant]);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('subscription_plans')
          .select('*')
          .order('price');
        
        if (error) {
          throw error;
        }

        if (data) {
          // Transform data to match Plan interface
          const formattedPlans: Plan[] = data.map(plan => ({
            id: plan.id,
            name: plan.name,
            description: plan.description,
            price: plan.price,
            features: plan.features || [],
            recommended: plan.recommended || false,
            imageUrl: plan.image_url || undefined
          }));
          
          setPlans(formattedPlans);
          logger.info('plans.loaded', { plan_count: formattedPlans.length });
        }
      } catch (error: any) {
        console.error('Error fetching plans:', error);
        logger.error('plans.load_failed', { error: error?.message || 'unknown' });
        toast({
          title: 'Error',
          description: 'Could not load subscription plans.',
          variant: 'destructive'
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchPlans();
  }, [toast]);

  // Handle plan selection - redirect to signup with selected plan
  const handleSelectPlan = (planId: string) => {
    // Find the selected plan to get its details
    const selectedPlan = plans.find(plan => plan.id === planId);
    
    if (selectedPlan) {
      // Calculate time spent on page
      const timeOnPage = (new Date().getTime() - pageLoadTime.getTime()) / 1000;
      
      // Extract numeric price value for analytics
      const planPrice = extractPriceValue(selectedPlan.price);
      
      // Track plan selection as test event with detailed properties
      captureTestEvent(
        'plan_selected', 
        'subscription_cta_test',
        ctaVariant,
        {
          plan_id: planId,
          plan_name: selectedPlan.name,
          plan_cost: planPrice,
          funnel_step: 'select_plan',
          time_to_decide: timeOnPage,
          conversion_value: planPrice,
          plan_features_count: selectedPlan.features.length,
          is_recommended: selectedPlan.recommended || false,
          timestamp: new Date().toISOString()
        }
      );
      
      // Also track as group event for subscription analytics
      captureEventWithGroup(
        'subscription_plan_selected',
        'subscription',
        selectedPlan.name, 
        {
          plan_id: planId,
          variant: ctaVariant || 'control',
          from_page: 'plans',
          time_on_page: timeOnPage
        }
      );
      
      // Log wide event with full business context
      logger.info('subscription.plan_selected', {
        plan_name: selectedPlan.name,
        plan_price: planPrice,
        is_recommended: selectedPlan.recommended || false,
        time_to_decide_seconds: Math.round(timeOnPage),
        ab_variant: ctaVariant || 'control',
        plan_features_count: selectedPlan.features.length,
      });

      // Navigate to signup with plan ID
      navigate(`/signup?plan=${planId}`);
    } else {
      navigate(`/signup?plan=${planId}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#141414]">
      <Navbar />
      <main className="pt-24 pb-12 px-4 md:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">Choose Your Perfect Hog Plan</h1>
            <p className="text-lg text-[#F1F0FB]/80 max-w-3xl mx-auto">
              Unlock the full potential of HogFlix with our flexible subscription options. 
              Find the perfect plan for your hedgehog entertainment needs.
            </p>
          </div>

          <PlanFeatures />
          
          <SubscriptionPlansGrid plans={plans} isLoading={isLoading} onSelectPlan={handleSelectPlan} />
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Plans;
