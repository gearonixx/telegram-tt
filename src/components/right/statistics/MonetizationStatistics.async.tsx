import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

import Loading from '../../ui/Loading';

const MonetizationStatisticsAsync = () => {
  const MonetizationStatistics = useModuleLoader(Bundles.Extra, 'MonetizationStatistics');

  return MonetizationStatistics ? <MonetizationStatistics /> : <Loading />;
};

export default MonetizationStatisticsAsync;
