import type TelegramClient from '../MockClient';

import { toJSNumber } from '../../../../util/numbers';
import Api from '../../tl/api';
import createMockedChannel from '../mockUtils/createMockedChannel';
import createMockedTypePeer from '../mockUtils/createMockedTypePeer';
import getDocumentIdFromLocation from '../mockUtils/getDocumentIdFromLocation';
import getIdFromInputPeer from '../mockUtils/getIdFromInputPeer';

import { MOCK_STARTING_DATE } from '../mockUtils/MockTypes';

// Synthetic media-heavy channels used by `perf/measure.mjs` to reproduce
// memory checkpoints without a real account. Histories are fabricated on the
// fly so the scenario JSON stays small.
//
// "Perf Channel" (id 2): every 3rd message is an animated sticker, every 7th
// is a run of animated custom emoji, the rest are text.
// "Perf Media" (id 3): every message is a ~540 KB 1200×1500 photo backed by
// the generated `__data__/perf-photo.png` (see `perf/gen-photo.mjs`).

const STICKER_CHANNEL_ID = '2';
const MEDIA_CHANNEL_ID = '3';
const STICKER_HISTORY_SIZE = 600;
const MEDIA_HISTORY_SIZE = 240;
const STICKER_EVERY = 3;
const CUSTOM_EMOJI_EVERY = 7;
const CUSTOM_EMOJI_PER_MESSAGE = 10;
const TGS_DOC_IDS = [2, 3, 4];
const PHOTO_DOC_ID = 5;
const PHOTO_ID_BASE = 1000;
const PHOTO_WIDTH = 1200;
const PHOTO_HEIGHT = 1500;
const FILLER = ' Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.';

export default function<A, R>(mockClient: TelegramClient, request: Api.Request<A, R>) {
  if (request instanceof Api.messages.GetHistory) {
    const peerId = getIdFromInputPeer(request.peer);
    if (peerId === STICKER_CHANNEL_ID) {
      return buildHistoryPage(
        mockClient, request, peerId, STICKER_HISTORY_SIZE, createStickerChannelMessage,
      ) as R;
    }
    if (peerId === MEDIA_CHANNEL_ID) {
      return buildHistoryPage(
        mockClient, request, peerId, MEDIA_HISTORY_SIZE, createMediaChannelMessage,
      ) as R;
    }
    return 'pass';
  }

  if (request instanceof Api.messages.GetCustomEmojiDocuments) {
    return request.documentId.map((docId) => (
      createTgsDocument(mockClient, toJSNumber(docId), true)
    )) as R;
  }

  if (request instanceof Api.upload.GetFile) {
    const locationId = getDocumentIdFromLocation(request.location);
    // Fabricated photos all share one document payload
    const docId = locationId >= PHOTO_ID_BASE ? PHOTO_DOC_ID : locationId;
    const document = mockClient.mockData.documents.find((doc) => doc.id === docId);
    if (!document?.bytes) return 'pass';

    // Serve the requested part (unlike the default mock, which always returns
    // the whole file and only works for files smaller than one part)
    const offset = toJSNumber(request.offset);
    const end = Math.min(offset + request.limit, document.bytes.length);
    return new Api.upload.File({
      type: new Api.storage.FileUnknown(),
      mtime: 0,
      bytes: new Uint8Array(document.bytes.subarray(offset, end)),
    }) as R;
  }

  return 'pass';
}

// MTProto `messages.getHistory` semantics over a synthetic history with
// descending ids `historySize .. 1`: the returned window starts at the first
// message with `id < offsetId` (the whole history when `offsetId` is 0),
// shifted by `addOffset`, and contains up to `limit` messages.
function buildHistoryPage(
  mockClient: TelegramClient,
  request: Api.messages.GetHistory,
  peerId: string,
  historySize: number,
  createMessage: (mockClient: TelegramClient, peerId: string, id: number) => Api.Message,
) {
  const { offsetId, addOffset, limit } = request;

  const anchorIndex = offsetId ? historySize - offsetId + 1 : 0;
  const start = Math.max(0, anchorIndex + (addOffset || 0));
  const end = Math.min(historySize, start + limit);

  const messages: Api.Message[] = [];
  for (let index = start; index < end; index++) {
    messages.push(createMessage(mockClient, peerId, historySize - index));
  }

  return new Api.messages.Messages({
    messages,
    chats: [createMockedChannel(peerId, mockClient.mockData)],
    users: [],
    topics: [],
  });
}

function createStickerChannelMessage(mockClient: TelegramClient, peerId: string, id: number) {
  const isSticker = id % STICKER_EVERY === 0;
  const isCustomEmoji = !isSticker && id % CUSTOM_EMOJI_EVERY === 0;

  return new Api.Message({
    id,
    peerId: createMockedTypePeer(peerId, mockClient.mockData),
    date: MOCK_STARTING_DATE + id,
    message: isSticker ? ''
      : isCustomEmoji ? '⭐'.repeat(CUSTOM_EMOJI_PER_MESSAGE)
        : `Perf message #${id}.${FILLER}`,
    media: isSticker ? createPerfStickerMedia(mockClient, id) : undefined,
    entities: isCustomEmoji ? createCustomEmojiEntities(id) : undefined,
  });
}

function createMediaChannelMessage(mockClient: TelegramClient, peerId: string, id: number) {
  return new Api.Message({
    id,
    peerId: createMockedTypePeer(peerId, mockClient.mockData),
    date: MOCK_STARTING_DATE + id,
    message: `Perf photo #${id}`,
    media: createPerfPhotoMedia(mockClient, id),
  });
}

function createPerfStickerMedia(mockClient: TelegramClient, messageId: number) {
  const docId = TGS_DOC_IDS[Math.floor(messageId / STICKER_EVERY) % TGS_DOC_IDS.length];

  return new Api.MessageMediaDocument({
    document: createTgsDocument(mockClient, docId, false),
  });
}

function createCustomEmojiEntities(messageId: number) {
  const entities: Api.TypeMessageEntity[] = [];
  for (let i = 0; i < CUSTOM_EMOJI_PER_MESSAGE; i++) {
    const docId = TGS_DOC_IDS[(messageId + i) % TGS_DOC_IDS.length];
    entities.push(new Api.MessageEntityCustomEmoji({
      offset: i,
      length: 1,
      documentId: BigInt(docId),
    }));
  }
  return entities;
}

function createTgsDocument(mockClient: TelegramClient, docId: number, isCustomEmoji: boolean) {
  const mockDocument = mockClient.mockData.documents.find((doc) => doc.id === docId)!;

  return new Api.Document({
    id: BigInt(docId),
    accessHash: BigInt(1),
    fileReference: new Uint8Array([0]),
    date: MOCK_STARTING_DATE,
    mimeType: mockDocument.mimeType,
    size: mockDocument.size,
    dcId: 2,
    thumbs: [],
    attributes: [
      isCustomEmoji
        ? new Api.DocumentAttributeCustomEmoji({
          alt: '⭐',
          stickerset: new Api.InputStickerSetEmpty(),
        })
        : new Api.DocumentAttributeSticker({
          alt: '⭐',
          stickerset: new Api.InputStickerSetEmpty(),
        }),
      new Api.DocumentAttributeImageSize({
        w: isCustomEmoji ? 100 : 512,
        h: isCustomEmoji ? 100 : 512,
      }),
    ],
  });
}

function createPerfPhotoMedia(mockClient: TelegramClient, messageId: number) {
  const document = mockClient.mockData.documents.find((doc) => doc.id === PHOTO_DOC_ID)!;
  const size = toJSNumber(document.size);

  return new Api.MessageMediaPhoto({
    photo: new Api.Photo({
      id: BigInt(PHOTO_ID_BASE + messageId),
      accessHash: BigInt(1),
      fileReference: new Uint8Array([0]),
      date: MOCK_STARTING_DATE,
      dcId: 2,
      sizes: [
        new Api.PhotoSize({
          type: 'm', w: Math.round(PHOTO_WIDTH / 4), h: Math.round(PHOTO_HEIGHT / 4), size,
        }),
        new Api.PhotoSize({
          type: 'x', w: PHOTO_WIDTH, h: PHOTO_HEIGHT, size,
        }),
        new Api.PhotoSize({
          type: 'y', w: PHOTO_WIDTH, h: PHOTO_HEIGHT, size,
        }),
      ],
    }),
  });
}
