import type { OwnProps } from './MessageRichText';

import { Bundles } from '../../util/moduleLoader';

import useModuleLoader from '../../hooks/useModuleLoader';

const MessageRichTextAsync = (props: OwnProps) => {
  const MessageRichText = useModuleLoader(Bundles.InstantView, 'MessageRichText');

  return MessageRichText ? <MessageRichText {...props} /> : undefined;
};

export default MessageRichTextAsync;
