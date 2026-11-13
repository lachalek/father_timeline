import portrait from './father-time.png';

type FatherTimeProps = {
  smashing?: boolean;
  className?: string;
};

export const FatherTime = ({
  smashing = false,
  className = '',
}: FatherTimeProps) => (
  <img
    src={portrait}
    alt=""
    draggable={false}
    className={`father-time inline-block shrink-0 object-contain ${smashing ? 'is-smashing' : ''} ${className}`}
  />
);
