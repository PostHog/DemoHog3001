
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../integrations/supabase/client';
import { Skeleton } from '../components/ui/skeleton';
import { Play, Plus, Check, ChevronLeft } from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import { useMyList } from '../utils/posthog/myList';
import { useFeatureFlagEnabled } from 'posthog-js/react';
import { safeCapture } from '../utils/posthog';
import { logger } from '../utils/posthog/logger';
import {
  Dialog,
  DialogContent,
} from "../components/ui/dialog";

const ContentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [content, setContent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(true);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { addToList, removeFromList, isInList } = useMyList();
  const showMyListFeature = useFeatureFlagEnabled('show_my_list_feature');

  // Fetch content details
  useEffect(() => {
    const fetchContent = async () => {
      if (!id) return;
      
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('content_items')
          .select('*')
          .eq('id', id)
          .single();
        
        if (error) {
          throw error;
        }
        
        setContent(data);
        
        // Log content view
        logger.info('content.detail.loaded', {
          content_id: data.id,
          content_type: data.type,
          content_title: data.title,
          has_video: !!data.video_url,
        });

        // Track view in PostHog
        safeCapture('content_detail_viewed', {
          contentId: data.id,
          contentTitle: data.title,
          contentType: data.type
        });
      } catch (error: any) {
        console.error('Error fetching content:', error);
        logger.error('content.load_failed', { content_id: id || 'unknown', error: error?.message || 'unknown' });
        toast({
          title: 'Error',
          description: 'Failed to load content details',
          variant: 'destructive'
        });
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchContent();
  }, [id, toast]);

  // Handler for My List button
  const handleMyListClick = async () => {
    if (!content) return;
    
    const isCurrentlyInList = isInList(content.id);
    
    if (isCurrentlyInList) {
      const success = await removeFromList(content.id);
      if (success) {
        toast({
          title: 'Removed from My List',
          description: `"${content.title}" has been removed from My List.`
        });
      }
    } else {
      const success = await addToList(content.id);
      if (success) {
        toast({
          title: 'Added to My List',
          description: `"${content.title}" has been added to My List.`
        });
      }
    }
    
    logger.debug('content.list_updated', {
      content_id: content.id,
      content_title: content.title,
      action: isCurrentlyInList ? 'remove' : 'add',
    });

    safeCapture('my_list_button_clicked', {
      contentId: content.id,
      contentTitle: content.title,
      location: 'content_detail',
      action: isCurrentlyInList ? 'remove' : 'add'
    });
  };

  // Close modal and navigate back
  const handleCloseModal = () => {
    if (isPlayingVideo) {
      setIsPlayingVideo(false);
      return;
    }
    setIsModalOpen(false);
    navigate(-1);
  };
  
  // Handle play button click
  const handlePlayClick = () => {
    if (!content?.video_url) {
      toast({
        title: 'No video available',
        description: 'This content does not have a video attached.',
        variant: 'destructive'
      });
      return;
    }
    
    setIsPlayingVideo(true);

    logger.debug('content.playback_started', {
      content_id: content?.id,
      content_title: content?.title,
    });

    safeCapture('content_play_clicked', {
      contentId: content?.id,
      contentTitle: content?.title,
      location: 'content_detail'
    });
  };

  if (isLoading) {
    return (
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="bg-netflix-darkgray border-netflix-darkgray text-white max-w-4xl w-[90vw] p-0 overflow-hidden">
          <Skeleton className="h-[50vh] w-full mb-8" />
          <div className="p-6">
            <Skeleton className="h-10 w-1/3 mb-4" />
            <Skeleton className="h-6 w-1/2 mb-8" />
            <Skeleton className="h-32 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!content) {
    return (
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="bg-netflix-darkgray border-netflix-darkgray text-white max-w-4xl w-[90vw] p-0">
          <div className="text-center py-8">
            <h1 className="text-netflix-red text-3xl font-bold mb-4">Content Not Found</h1>
            <p className="text-netflix-gray mb-8">The content you're looking for doesn't exist or has been removed.</p>
            <button 
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-netflix-white hover:text-netflix-red"
            >
              <ChevronLeft size={16} />
              Back
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  
  // Get video URL - use content's specific URL or default
  const videoUrl = content.video_url || 'https://www.youtube.com/embed/dQw4w9WgXcQ';

  return (
    <Dialog open={isModalOpen} onOpenChange={handleCloseModal}>
      <DialogContent className="bg-netflix-darkgray border-netflix-darkgray text-white max-w-4xl w-[90vw] p-0 overflow-hidden">
        {/* Video Player (when playing) */}
        {isPlayingVideo ? (
          <div className="relative w-full aspect-video">
            <button
              onClick={() => setIsPlayingVideo(false)}
              className="absolute top-4 right-4 z-50 p-2 bg-black/70 hover:bg-black text-white rounded-full transition-all"
              aria-label="Close video"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <iframe 
              src={`${videoUrl}?autoplay=1`}
              className="w-full h-full"
              allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              title={content.title}
            />
          </div>
        ) : (
          <>
            {/* Hero Banner */}
            <div className="relative">
              <button
                onClick={handleCloseModal}
                className="absolute top-4 right-4 z-50 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
                aria-label="Close"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
              <div className="w-full h-[40vh] relative">
                {content.backdrop_url ? (
                  <img 
                    src={content.backdrop_url} 
                    alt={content.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/placeholder.svg';
                    }}
                  />
                ) : content.poster_url ? (
                  <img 
                    src={content.poster_url} 
                    alt={content.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/placeholder.svg';
                    }}
                  />
                ) : (
                  <div className="w-full h-full bg-netflix-darkgray/50"></div>
                )}
                
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-netflix-black via-netflix-black/60 to-transparent"></div>
              </div>
              
              {/* Content details */}
              <div className="p-6">
                <h1 className="text-2xl md:text-3xl font-bold mb-3">{content.title}</h1>
                
                <div className="flex items-center space-x-4 text-sm text-netflix-gray mb-4">
                  <span>{content.release_year}</span>
                  {content.age_rating && <span>{content.age_rating}</span>}
                  {content.duration && <span>{content.duration}</span>}
                </div>
                
                <div className="flex flex-wrap gap-2 mb-6">
                  {content.genre && content.genre.map((g: string) => (
                    <span 
                      key={g}
                      className="px-3 py-1 bg-[#333] text-white text-xs rounded-full"
                    >
                      {g}
                    </span>
                  ))}
                </div>
                
                <div className="flex space-x-4 mb-6">
                  <button 
                    className="bg-netflix-red hover:bg-netflix-red/90 text-white py-2 px-6 rounded flex items-center gap-2"
                    onClick={handlePlayClick}
                  >
                    <Play size={20} />
                    Play
                  </button>
                  
                  {/* My List button - only show when feature flag is enabled */}
                  {showMyListFeature && (
                    <button 
                      className="bg-[#333] hover:bg-[#444] text-white py-2 px-6 rounded flex items-center gap-2"
                      onClick={handleMyListClick}
                    >
                      {content && isInList(content.id) ? (
                        <>
                          <Check size={20} />
                          Remove from My List
                        </>
                      ) : (
                        <>
                          <Plus size={20} />
                          Add to My List
                        </>
                      )}
                    </button>
                  )}
                </div>
                
                <p className="text-netflix-white max-w-3xl">{content.description}</p>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ContentDetail;
