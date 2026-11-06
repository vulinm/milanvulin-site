using System.Globalization;
using System.Text.Json.Nodes;

// GPU readings for the Live telemetry section. Two optional sources, both on the private model network:
//  - the model server (Ollama) says whether the chat model is loaded in video memory, and how much of it;
//  - a GPU exporter (GPU_METRICS_URL, Prometheus text format, for example utkuozdemir/nvidia_gpu_exporter) gives
//    load, memory, temperature and power of the card.
// Only the card's own numbers and the chat model are kept: no process list, no other models, nothing about other
// apps that share the GPU. If a source is missing or down, its tiles are simply not shown.
public sealed class GpuMonitor(IHttpClientFactory http, ChatService chat, IConfiguration cfg, ILogger<GpuMonitor> log) : BackgroundService
{
    private const int Minutes = Telemetry.WindowMinutes;
    private static readonly TimeSpan Every = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan MaxAge = TimeSpan.FromSeconds(60);

    private readonly string? _exporter = cfg["GPU_METRICS_URL"] is { Length: > 0 } u ? u : null;
    private readonly object _gate = new();
    private readonly Slot[] _ring = Enumerable.Range(0, Minutes).Select(_ => new Slot()).ToArray();
    private GpuReading? _reading;
    private DateTimeOffset _readingAt;
    private LoadedModel? _model;
    private bool _exporterDown;
    private bool _modelServerDown;

    public bool Configured => _exporter is not null || chat.Url is not null;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Configured) return;
        try
        {
            using var timer = new PeriodicTimer(Every);
            do
            {
                await SampleAsync(stoppingToken);
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // The API is shutting down.
        }
    }

    private async Task SampleAsync(CancellationToken ct)
    {
        if (_exporter is not null)
        {
            try
            {
                var text = await http.CreateClient("gpu").GetStringAsync(_exporter, ct);
                var reading = ParseReading(text);
                lock (_gate)
                {
                    _reading = reading;
                    _readingAt = DateTimeOffset.UtcNow;
                    if (reading is not null)
                    {
                        var slot = SlotFor(DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 60);
                        slot.Utilization = Math.Max(slot.Utilization ?? 0, reading.UtilizationPercent);
                        slot.MemoryMb = Math.Max(slot.MemoryMb ?? 0, reading.MemoryUsedMb);
                    }
                }
                if (_exporterDown) log.LogInformation("GPU exporter is reachable again");
                _exporterDown = false;
            }
            catch (Exception e) when (!ct.IsCancellationRequested)
            {
                if (!_exporterDown) log.LogWarning(e, "Could not read GPU metrics from the exporter");
                _exporterDown = true;
            }
        }

        if (chat.Url is not null && chat.Model is not null)
        {
            try
            {
                var json = JsonNode.Parse(await http.CreateClient("gpu").GetStringAsync($"{chat.Url}/api/ps", ct));
                var found = FindModel(json, chat.Model);
                lock (_gate) _model = found;
                if (_modelServerDown) log.LogInformation("Model server is reachable again");
                _modelServerDown = false;
            }
            catch (Exception e) when (!ct.IsCancellationRequested)
            {
                if (!_modelServerDown) log.LogWarning(e, "Could not ask the model server which model is loaded");
                _modelServerDown = true;
                lock (_gate) _model = null;
            }
        }
    }

    public object Snapshot()
    {
        var now = DateTimeOffset.UtcNow;
        var current = now.ToUnixTimeSeconds() / 60;
        lock (_gate)
        {
            var utilization = new double?[Minutes];
            var memory = new double?[Minutes];
            for (var i = 0; i < Minutes; i++)
            {
                var id = current - (Minutes - 1 - i);
                var slot = _ring[(int)(id % Minutes)];
                if (slot.Id != id) continue;
                utilization[i] = slot.Utilization;
                memory[i] = slot.MemoryMb;
            }

            var fresh = _reading is not null && now - _readingAt < MaxAge;
            return new
            {
                generatedAt = now,
                gpu = fresh ? _reading : null,
                model = _model,
                utilization,
                memoryMb = memory,
            };
        }
    }

    private Slot SlotFor(long id)
    {
        var slot = _ring[(int)(id % Minutes)];
        if (slot.Id != id) slot.Reset(id);
        return slot;
    }

    // Picks the chat model out of the model server's list of loaded models (other models are ignored).
    internal static LoadedModel? FindModel(JsonNode? json, string model)
    {
        if (json?["models"] is not JsonArray models) return null;
        foreach (var m in models)
        {
            var name = m?["name"]?.GetValue<string>();
            if (name is null || !(name == model || name.StartsWith(model + ":", StringComparison.Ordinal))) continue;
            var size = m?["size"]?.GetValue<long>() ?? 0;
            var vram = m?["size_vram"]?.GetValue<long>() ?? 0;
            return new LoadedModel(
                name,
                Math.Round(vram / 1048576.0),
                Math.Round(size / 1048576.0),
                size > 0 ? Math.Round(100.0 * vram / size) : 0,
                m?["context_length"]?.GetValue<int>());
        }
        return null;
    }

    // Reads the card's numbers out of Prometheus text. Only the first GPU is used.
    internal static GpuReading? ParseReading(string text)
    {
        var values = new Dictionary<string, double>();
        string? name = null;
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;

            var nameEnd = line.IndexOfAny(['{', ' ']);
            if (nameEnd <= 0) continue;
            var metric = line[..nameEnd];

            if (metric == "nvidia_smi_gpu_info" && name is null)
            {
                var start = line.IndexOf("name=\"", StringComparison.Ordinal);
                if (start >= 0)
                {
                    start += 6;
                    var end = line.IndexOf('"', start);
                    if (end > start) name = line[start..end];
                }
            }

            var space = line.LastIndexOf(' ');
            if (space > 0 && double.TryParse(line[(space + 1)..], NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                values.TryAdd(metric, value);
        }

        if (!values.TryGetValue("nvidia_smi_utilization_gpu_ratio", out var ratio) ||
            !values.TryGetValue("nvidia_smi_memory_used_bytes", out var used))
            return null;

        return new GpuReading(
            name,
            Math.Round(ratio * 100),
            Math.Round(used / 1048576.0),
            values.TryGetValue("nvidia_smi_memory_total_bytes", out var total) ? Math.Round(total / 1048576.0) : null,
            values.TryGetValue("nvidia_smi_temperature_gpu", out var temperature) ? Math.Round(temperature) : null,
            values.TryGetValue("nvidia_smi_power_draw_watts", out var power) ? Math.Round(power) : null);
    }

    private sealed class Slot
    {
        public long Id = -1;
        public double? Utilization;
        public double? MemoryMb;

        public void Reset(long id)
        {
            Id = id;
            Utilization = null;
            MemoryMb = null;
        }
    }
}

public sealed record GpuReading(string? Name, double UtilizationPercent, double MemoryUsedMb, double? MemoryTotalMb, double? TemperatureC, double? PowerW);

public sealed record LoadedModel(string Name, double VramMb, double SizeMb, double OnGpuPercent, int? ContextLength);
