import type { ApiPeer } from '../../api/types';

// Kept dependency-free: `UiLoader` needs it at boot, and importing it from
// `./chats` would drag the whole chat-helper tree into the boot bundle
export function getChatAvatarHash(
  owner: ApiPeer,
  size: 'normal' | 'big' = 'normal',
  avatarPhotoId = owner.avatarPhotoId,
) {
  if (!avatarPhotoId) {
    return undefined;
  }

  switch (size) {
    case 'big':
      return `profile${owner.id}?${avatarPhotoId}`;
    default:
      return `avatar${owner.id}?${avatarPhotoId}`;
  }
}
