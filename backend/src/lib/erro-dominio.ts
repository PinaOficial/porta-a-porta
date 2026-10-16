export class ErroDominio extends Error {
  constructor(
    public readonly codigo: string,
    public readonly statusHttp: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDominio";
  }
}
