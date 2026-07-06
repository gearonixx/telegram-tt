import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

import Loading from '../../ui/Loading';

const BoostStatisticsAsync = () => {
  const BoostStatistics = useModuleLoader(Bundles.Extra, 'BoostStatistics');

  return BoostStatistics ? <BoostStatistics /> : <Loading />;
};

export default BoostStatisticsAsync;
