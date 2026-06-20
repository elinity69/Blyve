import { Platform } from 'react-native';

// Only import ads on mobile platforms
let mobileAds: any = null;
let RewardedAd: any = null;
let RewardedAdEventType: any = null;
let TestIds: any = null;

if (Platform.OS !== 'web') {
  try {
    mobileAds = require('react-native-google-mobile-ads').default;
    const adsModule = require('react-native-google-mobile-ads');
    RewardedAd = adsModule.RewardedAd;
    RewardedAdEventType = adsModule.RewardedAdEventType;
    TestIds = adsModule.TestIds;
  } catch (error) {
    console.warn('Failed to load ads module:', error);
  }
}

const REWARDED_AD_UNIT_ID = __DEV__ 
  ? (TestIds?.REWARDED || 'test-rewarded') 
  : 'ca-app-pub-5310075752699995/3447971510';

let rewardedAd: any = null;

export async function initializeAds() {
  if (Platform.OS === 'web' || !mobileAds) {
    console.log('⚠️ Ads not available on this platform');
    return;
  }
  
  try {
    await mobileAds().initialize();
    console.log('✅ AdMob initialized');
    loadRewardedAd();
  } catch (error) {
    console.error('Failed to initialize ads:', error);
  }
}

export function loadRewardedAd() {
  if (Platform.OS === 'web' || !RewardedAd) {
    return;
  }
  
  try {
    rewardedAd = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
    });

    rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      console.log('✅ Rewarded ad loaded');
    });

    rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward: any) => {
      console.log('✅ User earned reward:', reward);
    });

    rewardedAd.load();
  } catch (error) {
    console.error('Failed to load rewarded ad:', error);
  }
}

export async function showRewardedAd(): Promise<boolean> {
  if (Platform.OS === 'web' || !rewardedAd) {
    return false;
  }
  
  return new Promise((resolve) => {
    if (!rewardedAd) {
      loadRewardedAd();
      resolve(false);
      return;
    }

    const unsubscribeLoaded = rewardedAd.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => {
        unsubscribeLoaded();
        rewardedAd?.show().then(() => {
          resolve(true);
        }).catch((error: unknown) => {
          console.error('Error showing ad:', error);
          resolve(false);
        });
      }
    );

    const unsubscribeEarned = rewardedAd.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      () => {
        unsubscribeEarned();
        loadRewardedAd(); // Pre-load next ad
      }
    );

    // If already loaded, show immediately
    if (rewardedAd.loaded) {
      rewardedAd.show().then(() => {
        resolve(true);
      }).catch((error: unknown) => {
        console.error('Error showing ad:', error);
        resolve(false);
      });
    } else {
      // Wait for ad to load
      setTimeout(() => {
        resolve(false);
      }, 10000); // 10 second timeout
    }
  });
}

