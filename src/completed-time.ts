/** Only explicit ISO date-times with a timezone represent a completion time. */
export function completedDate(value:unknown):Date|null {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const milliseconds=Date.parse(value);
  return Number.isFinite(milliseconds)?new Date(milliseconds):null;
}
