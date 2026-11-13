import body from './father-time-body.png';
import scythe from './father-time-scythe.png';

type FatherTimeProps = {
  smashing?: boolean;
  className?: string;
};

export const FatherTime = ({
  smashing = false,
  className = '',
}: FatherTimeProps) => (
  <span
    className={`father-time relative inline-block shrink-0 ${smashing ? 'is-smashing' : ''} ${className}`}
  >
    <img
      src={body}
      alt=""
      draggable={false}
      className="block h-full w-auto select-none"
    />
    <img
      src={scythe}
      alt=""
      draggable={false}
      className="father-scythe pointer-events-none absolute inset-0 h-full w-full select-none"
    />
  </span>
);
