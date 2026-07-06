import type { OwnProps } from './MediaEditor';

import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

const MediaEditorAsync = (props: OwnProps) => {
  const { isOpen } = props;
  const MediaEditor = useModuleLoader(Bundles.MediaEditor, 'MediaEditor', !isOpen);

  return MediaEditor ? <MediaEditor {...props} /> : undefined;
};

export default MediaEditorAsync;
