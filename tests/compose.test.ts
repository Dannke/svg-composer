import { describe, expect, it, vi } from 'vitest';
import { compose, parseLlmAnswer } from '../src/server/compose';

const answer = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('валидация ответа LLM', () => {
  it('принимает только id из каталога', () => {
    expect(parseLlmAnswer('Вот: {"objects":["lamp","rocket","lamp","book"],"preset":"offset"}')).toEqual({ slugs: ['lamp', 'book'], preset: 'offset', reason: undefined });
  });
  it('отклоняет мусор и неизвестные id; неверный пресет → assembled', () => {
    expect(parseLlmAnswer('не json')).toBeNull();
    expect(parseLlmAnswer('{"objects":["rocket"]}')).toBeNull();
    expect(parseLlmAnswer('{"objects":"lamp"}')).toBeNull();
    expect(parseLlmAnswer('{"objects":["pen"],"preset":"zigzag"}')?.preset).toBe('assembled');
  });
});

describe('compose: модели, запасной режим, кэш', () => {
  it('переходит к следующей модели при ошибке', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(answer('{"objects":["coin","wallet"],"preset":"assembled"}'));
    const r = await compose('запрос-1', { apiKey: 'k', models: ['a:free', 'b:free'], fetch: f });
    expect(r).toMatchObject({ slugs: ['coin', 'wallet'], source: 'llm', model: 'b:free' });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('без валидного ответа — поиск по ключевым словам', async () => {
    const f = vi.fn().mockResolvedValue(answer('{"objects":["rocket"]}'));
    const r = await compose('экономия денег', { apiKey: 'k', models: ['a:free'], fetch: f });
    expect(r.source).toBe('keywords');
    expect(r.slugs).toContain('coin');
  });
  it('без ключа LLM не вызывается; ответ кэшируется', async () => {
    const f = vi.fn();
    const a = await compose('музыка для учёбы', { fetch: f });
    const b = await compose('Музыка для учёбы ', { fetch: f });
    expect(f).not.toHaveBeenCalled();
    expect(a.slugs).toContain('headphones');
    expect(b).toBe(a);
  });
  it('успешный ответ LLM кэшируется', async () => {
    const f = vi.fn().mockResolvedValue(answer('{"objects":["lamp"]}'));
    await compose('кэш-тест', { apiKey: 'k', models: ['a:free'], fetch: f });
    await compose('кэш-тест', { apiKey: 'k', models: ['a:free'], fetch: f });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
