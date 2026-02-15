/**
 * Share Channels - configuration of available sharing platforms
 */

export interface ShareChannel {
  name: string;
  type: string;
  icon: string;
}

const SHARE_CHANNELS: ShareChannel[] = [
  { name: 'Twitter/X', type: 'social', icon: 'twitter' },
  { name: 'LinkedIn', type: 'social', icon: 'linkedin' },
  { name: '微信', type: 'social', icon: 'wechat' },
  { name: '复制链接', type: 'utility', icon: 'link' },
  { name: '复制徽章', type: 'utility', icon: 'badge' },
  { name: 'Discord', type: 'social', icon: 'discord' },
  { name: 'Reddit', type: 'social', icon: 'reddit' },
];

export function getShareChannels(): ShareChannel[] {
  return [...SHARE_CHANNELS];
}
