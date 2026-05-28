import { useState, useEffect, useRef } from 'react';
import { Camera, X, ChevronLeft, Upload, Eye } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { getCachedUser, resolveAuthUser } from '../lib/authSession';
import { toast } from '../lib/toast';
import { useTranslation } from 'react-i18next';
import { SharedProfileView } from './SharedProfileView';
// NavigationStack is handled by parent - no need to import

interface MediaEditScreenProps {
  profile: any;
  onBack: () => void;
  previousScreen?: React.ReactNode; // Optional: Previous screen for parallax effect
}

export function MediaEditScreen({ profile, onBack, previousScreen }: MediaEditScreenProps) {
  const { t } = useTranslation();
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Single primary profile image (gallery collapsed to one).
    const profileImages = profile?.images || [];
    const validImages = profileImages
      .filter((img: string) => img && typeof img === 'string' && img.trim().length > 0)
      .slice(0, 1);
    setImages(validImages);
  }, [profile]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Single profile image only: take first selected file.
    const filesToUpload = [files[0]];

    if (filesToUpload.length === 0) {
      setUploadError('Please select an image');
      return;
    }

    setUploading(true);
    setUploadError('');

    try {
      // Get user first
      const user = getCachedUser() ?? (await resolveAuthUser());
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Upload each file
      const uploadedUrls: string[] = [];
      
      for (const file of filesToUpload) {
        if (file.size > 5 * 1024 * 1024) {
          setUploadError(`${file.name} is too large (max 5MB)`);
          continue;
        }

        if (!file.type.startsWith('image/')) {
          setUploadError(`${file.name} is not an image`);
          continue;
        }

        // Generate file path: userId/timestamp-filename.jpg
        const fileExtension = file.name.split('.').pop() || 'jpg';
        const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
        const bucketName = 'avatars';

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, file, {
            contentType: file.type || 'image/jpeg',
            upsert: false,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          setUploadError(`Failed to upload ${file.name}: ${uploadError.message}`);
          continue;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        uploadedUrls.push(publicUrl);
      }

      // Single image profile: newest uploaded image replaces old one.
      const currentImages = images.length > 0 ? images : (profile?.images || []);
      const latestUploaded = uploadedUrls[uploadedUrls.length - 1];
      const updatedImages = latestUploaded ? [latestUploaded] : currentImages.slice(0, 1);
      
      setImages(updatedImages);

      const updateData: any = {
        images: updatedImages,
        avatar_url: updatedImages.length > 0 ? updatedImages[0] : null,
      };

      // Update profile in database - images array and sync avatar_url
      const { error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id);

      if (updateError) {
        console.error('Failed to update profile:', updateError);
        setUploadError('Failed to save images to profile');
      } else {
        toast.success('Profilbild aktualisiert', 'Profile image updated successfully!');
      }
    } catch (error: any) {
      console.error('Upload failed:', error);
      setUploadError(error.message || 'Failed to upload images. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = async (index: number) => {
      const removedImage = images[index];
      
      // Delete image from storage first
      try {
        // Extract path from URL: https://...supabase.co/storage/v1/object/public/avatars/userId/timestamp.jpg
        const urlParts = removedImage.split('/avatars/');
        if (urlParts.length > 1) {
          const imagePath = urlParts[1];
          const { error: deleteError } = await supabase.storage
            .from('avatars')
            .remove([imagePath]);
          
          if (deleteError) {
            console.warn('Failed to delete image from storage:', deleteError);
            // Continue with removal from profile even if storage delete fails
          } else {
            console.log('Image deleted from storage');
          }
        }
      } catch (deleteErr) {
        console.warn('Error deleting image from storage:', deleteErr);
        // Continue with removal from profile even if storage delete fails
      }
      
      // Remove the image from array
      const updatedImages = images.filter((_, i) => i !== index);
      setImages(updatedImages);

      // Update profile in database
      try {
        const user = getCachedUser() ?? (await resolveAuthUser());
        if (!user) {
          throw new Error('User not authenticated');
        }

        const updateData: any = {
          images: updatedImages,
        avatar_url: updatedImages.length > 0 ? updatedImages[0] : null,
        };

        const { error: updateError } = await supabase
          .from('profiles')
          .update(updateData)
          .eq('id', user.id);

      if (updateError) {
        console.error('Failed to update profile:', updateError);
        setUploadError('Failed to remove image');
      }
    } catch (error: any) {
      console.error('Failed to remove image:', error);
      setUploadError(error.message || 'Failed to remove image');
    }
  };

  const handleImageClick = (image: string) => {
    setSelectedImage(image);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // NavigationStack is handled by parent - just return content
  return (
    <div className="h-full bg-white dark:bg-black md:dark:bg-[#121212] overflow-y-auto pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-white/80 dark:bg-black/80 md:dark:bg-[#121212]/80 backdrop-blur-md border-b border-gray-200 dark:border-white/5 p-4 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors relative z-50"
            >
              <ChevronLeft className="w-6 h-6 text-gray-700 dark:text-white" />
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPreview(false)}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-colors border ${
                  !showPreview 
                    ? 'bg-orange-600 text-white shadow-lg border-transparent' 
                    : 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800 dark:border-slate-700 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-slate-700 media-edit-toggle-btn'
                }`}
              >
                {t('profile.edit')}
              </button>
              <button
                onClick={() => setShowPreview(true)}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-colors border ${
                  showPreview 
                    ? 'bg-orange-600 text-white border-transparent' 
                    : 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800 dark:border-slate-700 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-slate-700 media-edit-toggle-btn'
                }`}
              >
                {t('profile.preview')}
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors"
          >
            <Eye className="w-6 h-6 text-gray-700 dark:text-white" />
          </button>
        </div>
      </div>

      {/* Single profile image slot */}
      <div className="p-4">
        <div className="max-w-sm mx-auto">
          <div
            className={`aspect-square rounded-xl overflow-hidden relative border-2 ${
              images[0]
                ? 'border-gray-200 dark:border-white/5'
                : 'border-dashed border-gray-300 dark:border-white/5 bg-gray-50 dark:bg-[#0A0A0A]'
            }`}
          >
            {!images[0] ? (
              <button
                onClick={triggerFileInput}
                disabled={uploading}
                className="w-full h-full flex flex-col items-center justify-center gap-2 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-orange-600 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </button>
            ) : (
              <>
                <img
                  src={images[0]}
                  alt={t('profile.profileImage', { number: 1 })}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => handleImageClick(images[0])}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveImage(0);
                  }}
                  className="absolute top-2 right-2 w-6 h-6 bg-orange-600 rounded-full flex items-center justify-center text-white shadow-lg hover:bg-orange-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="absolute bottom-2 left-2 bg-gradient-to-r from-orange-500 to-pink-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                  {t('profile.main')}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Instruction Text */}
        <div 
          className="mt-6 p-4 rounded-xl border border-orange-200"
          data-dark-border="rgba(203, 208, 231, 0.1)"
        >
          <p className="text-sm text-gray-700 dark:text-white text-center font-semibold">
            {t('profile.addMediaDescription', { percent: 4 })}
          </p>
        </div>

        {/* Add Media Button */}
        <Button
          onClick={triggerFileInput}
          disabled={uploading}
          className="w-full mt-4 bg-gradient-to-r from-orange-500 via-pink-500 to-red-500 hover:from-orange-600 hover:via-pink-600 hover:to-red-600 text-white font-bold py-4 rounded-xl"
        >
          <Upload className="w-5 h-5 mr-2" />
          {uploading ? t('profile.loading') : images[0] ? t('profile.edit') : t('profile.addMedia')}
        </Button>

        {/* Upload Error */}
        {uploadError && (
          <div className="mt-4 bg-red-50 dark:bg-[#0A0A0A] border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
            {uploadError}
          </div>
        )}

        {/* Hidden file input - single image only */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Image Preview Modal (for individual images) */}
      {selectedImage && !showPreview && (
          <div
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
            onClick={() => {
              setSelectedImage(null);
            }}
          >
            <div className="relative max-w-2xl w-full h-full flex items-center justify-center">
              <img
                src={selectedImage}
                alt="Preview"
                className="max-w-full max-h-full object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => {
                  setSelectedImage(null);
                }}
                className="absolute top-4 right-4 w-10 h-10 bg-orange-600/90 hover:bg-orange-700 rounded-full flex items-center justify-center text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}

      {showPreview && profile && (
        <SharedProfileView
          profile={{
            ...profile,
            images,
            avatar_url: images[0] || profile?.avatar_url || null,
          }}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

