import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';

export function CalendarPicker({
  selected,
  minDate,
  maxDate,
  onSelect,
}: {
  selected: Date;
  /** Dates before this are disabled (optional). */
  minDate?: Date;
  /** Dates after this are disabled (optional). */
  maxDate?: Date;
  onSelect: (d: Date) => void;
}) {
  const colors = useColors();
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());

  const min = minDate
    ? new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())
    : null;
  const max = maxDate
    ? new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())
    : null;

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const MONTH_NAMES = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={prevMonth} hitSlop={12} style={styles.navBtn}>
          <Icon name="chevron-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.monthLabel, { color: colors.foreground }]}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </Text>
        <Pressable onPress={nextMonth} hitSlop={12} style={styles.navBtn}>
          <Icon name="chevron-right" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={styles.row}>
        {DOW.map(d => (
          <Text key={d} style={[styles.dowCell, { color: colors.mutedForeground }]}>{d}</Text>
        ))}
      </View>

      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={styles.row}>
          {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
            if (!day) return <View key={col} style={styles.dayCell} />;
            const cellDate = new Date(viewYear, viewMonth, day);
            const isPast = (min !== null && cellDate < min) || (max !== null && cellDate > max);
            const isSel =
              selected.getFullYear() === viewYear &&
              selected.getMonth() === viewMonth &&
              selected.getDate() === day;
            return (
              <Pressable
                key={col}
                onPress={() => !isPast && onSelect(cellDate)}
                style={[
                  styles.dayCell,
                  isSel && { backgroundColor: colors.primary, borderRadius: 8 },
                  isPast && { opacity: 0.3 },
                ]}
              >
                <Text style={{
                  fontSize: 14,
                  fontWeight: isSel ? '700' : '400',
                  color: isSel ? colors.primaryForeground : colors.foreground,
                  textAlign: 'center',
                }}>
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  navBtn: { padding: 6 },
  monthLabel: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row' },
  dowCell: { flex: 1, textAlign: 'center', fontSize: 12, paddingVertical: 4 },
  dayCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
});
