import { useState, useRef } from 'react';
import { Button } from './ui/button';
import { Camera, Upload, Flame, Award } from 'lucide-react';
import { api } from '../lib/api';

interface ProfilePictureUploadProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function ProfilePictureUpload({ onComplete, onSkip }: ProfilePictureUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log('Profile upload - file selected:', file.name, file.size, file.type);

      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be less than 5MB');
        return;
      }

      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
        return;
      }

      setSelectedFile(file);
      setError('');

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);
      setError('');
      console.log('Profile upload - starting upload...');
      
      const response = await api.uploadProfilePicture(selectedFile);
      console.log('Profile upload - completed successfully:', response);
      
      onComplete();
    } catch (err: any) {
      console.error('Profile upload - failed:', err);
      setError(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="h-screen bg-gradient-to-br from-blyve via-blyve to-blyve-hover flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Flame className="w-8 h-8 text-blyve" />
            <h1 className="text-2xl font-bold text-blyve">
              Add Your Photo
            </h1>
          </div>
          <p className="text-gray-600">
            Add a profile photo so friends recognize you in chats and servers.
          </p>
        </div>

        {/* Bonus Points Badge */}
        <div className="bg-blyve/10 border-2 border-blyve/25 rounded-2xl p-3 mb-6">
          <div className="flex items-center justify-center gap-2 text-blyve font-medium">
            <Award className="w-5 h-5" />
            <span className="font-semibold text-sm">Earn 50 Points for adding your photo!</span>
          </div>
        </div>

        {/* Upload Area */}
        <div className="mb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!previewUrl ? (
            <button
              onClick={triggerFileInput}
              className="w-full aspect-square border-3 border-dashed border-gray-300 rounded-3xl hover:border-blyve transition-colors flex flex-col items-center justify-center gap-4 bg-gray-50 hover:bg-gradient-to-br hover:from-blyve/10 hover:via-blyve/5 hover:to-blyve/10"
            >
              <div className="w-20 h-20 bg-blyve rounded-full flex items-center justify-center">
                <Camera className="w-10 h-10 text-white" />
              </div>
              <div className="text-center px-4">
                <p className="font-semibold text-gray-700 mb-1">Click to upload photo</p>
                <p className="text-sm text-gray-500">JPG, PNG up to 5MB</p>
              </div>
            </button>
          ) : (
            <div className="relative">
              <img
                src={previewUrl}
                alt="Preview"
                className="w-full aspect-square object-cover rounded-3xl"
              />
              <button
                onClick={triggerFileInput}
                className="absolute bottom-4 right-4 bg-white hover:bg-gray-100 rounded-full p-3 shadow-lg transition-colors"
              >
                <Upload className="w-5 h-5 text-gray-700" />
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="border border-blyve/25 bg-blyve/10 text-gray-700 dark:text-gray-200 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          {selectedFile && (
            <Button
              onClick={handleUpload}
              disabled={uploading}
              className="w-full bg-blyve hover:bg-blyve-hover h-12 text-lg"
            >
              {uploading ? 'Uploading...' : 'Continue'}
            </Button>
          )}

          <Button
            onClick={onSkip}
            variant="ghost"
            className="w-full text-gray-600 hover:text-gray-900"
          >
            Skip for now
          </Button>
        </div>

        {/* Info Text */}
        <p className="text-xs text-gray-500 text-center mt-4">
          Profiles with a photo feel more personal and trustworthy.
        </p>
      </div>
    </div>
  );
}