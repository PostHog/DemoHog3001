
import { useEffect } from 'react';
import { PostHogProvider as OriginalPostHogProvider } from 'posthog-js/react';
import { initLogger } from '../../utils/posthog/logger';

interface PostHogInitializerProps {
  apiKey: string;
  apiHost: string;
  children: React.ReactNode;
  onLoaded: () => void;
}

export const PostHogInitializer = ({ 
  apiKey, 
  apiHost, 
  children, 
  onLoaded 
}: PostHogInitializerProps) => {
  // Log configuration on mount for debugging
  useEffect(() => {
    console.log(`Initializing PostHog with host: ${apiHost}`);
  }, [apiHost]);

  return (
    <OriginalPostHogProvider 
      apiKey={apiKey}
      options={{
        api_host: apiHost,
        persistence: 'localStorage' as const,
        capture_pageview: false, // Disable automatic pageview capture - we'll handle it manually
        autocapture: true,
        loaded: (posthogInstance: any) => {
          console.log('PostHog loaded successfully');
          initLogger();
          onLoaded();
        }
      }}
    >
      {children}
    </OriginalPostHogProvider>
  );
};

export default PostHogInitializer;
