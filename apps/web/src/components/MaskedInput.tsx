import { forwardRef } from 'react';
import {
  applyCurrency,
  applyCpf,
  applyCnpj,
  applyCpfOrCnpj,
  applyPhone,
  applyCep,
  applyDate,
  applyPercent,
  applyInteger,
} from '../lib/masks';

type MaskType = 'currency' | 'cpf' | 'cnpj' | 'cpfOrCnpj' | 'phone' | 'cep' | 'date' | 'percent' | 'integer';

interface MaskedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  mask: MaskType;
  value: string;
  onChange: (masked: string) => void;
  prefix?: string;
}

const APPLIERS: Record<MaskType, (v: string) => string> = {
  currency: applyCurrency,
  cpf: applyCpf,
  cnpj: applyCnpj,
  cpfOrCnpj: applyCpfOrCnpj,
  phone: applyPhone,
  cep: applyCep,
  date: applyDate,
  percent: applyPercent,
  integer: applyInteger,
};

const INPUT_MODE: Partial<Record<MaskType, 'numeric' | 'decimal' | 'tel'>> = {
  currency: 'decimal',
  cpf: 'numeric',
  cnpj: 'numeric',
  cpfOrCnpj: 'numeric',
  phone: 'tel',
  cep: 'numeric',
  date: 'numeric',
  percent: 'decimal',
  integer: 'numeric',
};

export const MaskedInput = forwardRef<HTMLInputElement, MaskedInputProps>(function MaskedInput(
  { mask, value, onChange, prefix, className, ...rest }: MaskedInputProps,
  ref,
): JSX.Element {
  const apply = APPLIERS[mask];
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onChange(apply(e.target.value));
  };

  if (prefix) {
    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">{prefix}</span>
        <input
          ref={ref}
          type="text"
          inputMode={INPUT_MODE[mask]}
          value={value}
          onChange={handleChange}
          className={`pl-9 ${className ?? ''}`}
          {...rest}
        />
      </div>
    );
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode={INPUT_MODE[mask]}
      value={value}
      onChange={handleChange}
      className={className}
      {...rest}
    />
  );
});
