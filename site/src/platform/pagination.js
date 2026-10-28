// PostgREST caps each response. Explicit ranges prevent silently truncated exports.
export async function readPages(query, size = 500) {
    const rows = [];
    for (let offset = 0; ; offset += size) {
        const {data,error} = await query().range(offset, offset + size - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < size) return rows;
    }
}
