import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';

// Simple four-function calculator presented as a bottom-sheet modal. Pure
// UI convenience — nothing here is persisted or trusted by the server.

type Op = '+' | '-' | '×' | '÷';

function applyOp(a: number, b: number, op: Op): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b === 0 ? NaN : a / b;
  }
}

/** Trim float noise: up to 8 significant decimals, no trailing zeros. */
function formatResult(n: number): string {
  if (!isFinite(n)) return 'Error';
  const s = parseFloat(n.toPrecision(12)).toString();
  return s.length > 14 ? n.toExponential(6) : s;
}

export function CalculatorModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const [display, setDisplay] = React.useState('0');
  const [prev, setPrev] = React.useState<number | null>(null);
  const [op, setOp] = React.useState<Op | null>(null);
  // After an operator or "=", the next digit starts a fresh entry.
  const [startNew, setStartNew] = React.useState(true);

  function pressDigit(d: string) {
    setDisplay((cur) => {
      if (startNew || cur === '0' || cur === 'Error') return d === '.' ? '0.' : d;
      if (d === '.' && cur.includes('.')) return cur;
      if (cur.replace(/[.-]/g, '').length >= 12) return cur;
      return cur + d;
    });
    setStartNew(false);
  }

  function pressOp(nextOp: Op) {
    const current = parseFloat(display);
    if (isNaN(current)) return;
    if (prev != null && op != null && !startNew) {
      const result = applyOp(prev, current, op);
      setPrev(isNaN(result) ? null : result);
      setDisplay(formatResult(result));
    } else {
      setPrev(current);
    }
    setOp(nextOp);
    setStartNew(true);
  }

  function pressEquals() {
    const current = parseFloat(display);
    if (prev == null || op == null || isNaN(current)) return;
    const result = applyOp(prev, current, op);
    setDisplay(formatResult(result));
    setPrev(null);
    setOp(null);
    setStartNew(true);
  }

  function pressClear() {
    setDisplay('0');
    setPrev(null);
    setOp(null);
    setStartNew(true);
  }

  function pressBackspace() {
    if (startNew || display === 'Error') return;
    setDisplay((cur) => (cur.length <= 1 ? '0' : cur.slice(0, -1)));
  }

  function pressPlusMinus() {
    setDisplay((cur) =>
      cur === '0' || cur === 'Error' ? cur : cur.startsWith('-') ? cur.slice(1) : `-${cur}`,
    );
  }

  function pressPercent() {
    const n = parseFloat(display);
    if (isNaN(n)) return;
    setDisplay(formatResult(n / 100));
    setStartNew(true);
  }

  const Key = ({
    label,
    onPress,
    variant = 'digit',
    wide = false,
    active = false,
  }: {
    label: string;
    onPress: () => void;
    variant?: 'digit' | 'op' | 'fn';
    wide?: boolean;
    active?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.key,
        wide && s.keyWide,
        {
          backgroundColor:
            variant === 'op'
              ? active
                ? colors.foreground
                : colors.secondary
              : variant === 'fn'
                ? colors.muted
                : colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          s.keyText,
          {
            color:
              variant === 'op'
                ? active
                  ? colors.background
                  : '#fff'
                : colors.foreground,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[s.overlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
        {/* Tap outside to dismiss */}
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={s.header}>
            <Text style={[s.title, { color: colors.foreground }]}>Calculator</Text>
            <Pressable onPress={onClose} style={s.closeBtn} hitSlop={8}>
              <Icon name="x" size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <View style={[s.display, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {prev != null && op != null && (
              <Text style={[s.displayPrev, { color: colors.mutedForeground }]}>
                {formatResult(prev)} {op}
              </Text>
            )}
            <Text
              style={[s.displayText, { color: colors.foreground }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {display}
            </Text>
          </View>

          <View style={s.grid}>
            <View style={s.row}>
              <Key label="C" variant="fn" onPress={pressClear} />
              <Key label="±" variant="fn" onPress={pressPlusMinus} />
              <Key label="%" variant="fn" onPress={pressPercent} />
              <Key label="÷" variant="op" active={op === '÷' && startNew} onPress={() => pressOp('÷')} />
            </View>
            <View style={s.row}>
              <Key label="7" onPress={() => pressDigit('7')} />
              <Key label="8" onPress={() => pressDigit('8')} />
              <Key label="9" onPress={() => pressDigit('9')} />
              <Key label="×" variant="op" active={op === '×' && startNew} onPress={() => pressOp('×')} />
            </View>
            <View style={s.row}>
              <Key label="4" onPress={() => pressDigit('4')} />
              <Key label="5" onPress={() => pressDigit('5')} />
              <Key label="6" onPress={() => pressDigit('6')} />
              <Key label="-" variant="op" active={op === '-' && startNew} onPress={() => pressOp('-')} />
            </View>
            <View style={s.row}>
              <Key label="1" onPress={() => pressDigit('1')} />
              <Key label="2" onPress={() => pressDigit('2')} />
              <Key label="3" onPress={() => pressDigit('3')} />
              <Key label="+" variant="op" active={op === '+' && startNew} onPress={() => pressOp('+')} />
            </View>
            <View style={s.row}>
              <Key label="0" wide onPress={() => pressDigit('0')} />
              <Key label="." onPress={() => pressDigit('.')} />
              <Key label="⌫" variant="fn" onPress={pressBackspace} />
              <Key label="=" variant="op" onPress={pressEquals} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  display: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    alignItems: 'flex-end',
    minHeight: 78,
    justifyContent: 'flex-end',
  },
  displayPrev: {
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  displayText: {
    fontSize: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  grid: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  key: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: {
    flex: 2.15,
  },
  keyText: {
    fontSize: 22,
    fontWeight: '600',
  },
});
