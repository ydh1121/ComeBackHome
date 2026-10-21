import { TimeRangeWheelPicker as PortableTimeRangeWheelPicker, type TimeRangeWheelPickerProps } from '../../../packages/portable/react/TimeRangeWheelPicker';
import './wheel-time-picker.css';
const labels = { select: '선택', done: '완료', time: '시간', hours: '시간 선택', minutes: '분 선택', hourUnit: '시', minuteUnit: '분' };
export function TimeRangeWheelPicker(props: Omit<TimeRangeWheelPickerProps, 'labels' | 'fallbackHours'>) {
  return <PortableTimeRangeWheelPicker startLabel="출근" endLabel="퇴근" {...props} labels={labels} />;
}
