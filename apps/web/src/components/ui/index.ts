// Kit mobile-first minimo (D18 de fluxo-caixa-dre). Importar daqui:
//   import { PageHeader, KpiRow, KpiCard, DateRangeFilter, Badge, DataStatusBadge,
//            DataQualityBanner, CardList, QueryState, CopyWhatsAppButton } from '../components/ui';
export { PageHeader, PageContainer, type PageHeaderProps } from './PageHeader';
export { KpiCard, KpiRow, type KpiCardProps, type KpiRowProps, type KpiTone, type KpiCols } from './KpiCard';
export { DateRangeFilter, type DateRangeFilterProps } from './DateRangeFilter';
export { Badge, DataStatusBadge, FilterChip, DATA_STATUS_LABEL, type BadgeProps, type BadgeTone } from './Badge';
export {
  DataQualityBanner,
  metaToItems,
  qualityToItems,
  dreLinesToItems,
  STALENESS_LIMIT_SECONDS,
  type DataQualityBannerProps,
  type QualityItem,
  type QualityKind,
} from './DataQualityBanner';
export { CardList, CardRow, CardMeta, type CardListProps, type CardListColumn } from './CardList';
export { QueryState, LoadingBox, ErrorBox, EmptyBox, type QueryStateProps, type QueryLike } from './QueryState';
export { CopyWhatsAppButton, type CopyWhatsAppButtonProps } from './CopyWhatsAppButton';
export { Pagination } from './Pagination';
