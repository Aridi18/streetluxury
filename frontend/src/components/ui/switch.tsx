import * as S from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ checked, onCheckedChange, disabled, id, label }: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  return (
    <S.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border border-line-strong bg-raised transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50",
      )}
    >
      <S.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[21px]" />
    </S.Root>
  );
}
