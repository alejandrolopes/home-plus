# Relatório: atualização do mapa do multimídia do Corolla 2018

Data: 2026-10-29

## Objetivo
Atualizar o mapa de navegação do rádio original do Toyota Corolla (ano 2017, modelo 2018), desatualizado desde 2018. A ideia inicial era "hackear" o rádio, mas o objetivo real é só ter um mapa atualizado.

## Dados do veículo e do rádio (lidos nas fotos)
| Item | Valor |
|---|---|
| Veículo | Toyota Corolla 2017, modelo 2018 (Porto Alegre, RS, pelas ruas no mapa) |
| ID mode | 13TDANLA-EA00 |
| Nº hardware | 86100-02260 |
| SAM ID | AEAIDFAKGU |
| Versão do mapa | 1.4.A4 |
| Versão dos dados de pesquisa | 1.4.A4 |
| Cartão de mapa | microSDHC Toyota, peça 86271-02032, serial SJ7BBB10064, "Made in Japan" |
| Slot do cartão | No painel, acima do rádio, com etiqueta "microSD MAP CARD" |
| Tela de atualização | Navegação: Atual `****`, Novo `****` (nenhum arquivo de atualização detectado) |
| Funções visíveis | GPS, Bluetooth (contato "Ale" pareado). Aparentemente sem CarPlay/Android Auto (não confirmado) |

## O que já foi apurado
1. **A concessionária Toyota informou que não atualiza mais esse mapa.**
2. O mapa fica em um **cartão microSD original da Toyota (86271-02032)**. Atualizar significa trocar o cartão ou o conteúdo dele, e não alterar o firmware do rádio.
3. Pesquisas na web não acharam um procedimento oficial da Toyota Brasil para o hardware 86100-02260. Fontes consultadas:
   - Relato de dono de Corolla XEi 2018 sobre atualização por cartão SD: https://www.carroclub.com.br/carros/toyota/corolla/forum/?id=49763 (informal, não confirmado)
   - Reclamações sobre falta de atualização de mapas pela Toyota: https://www.reclameaqui.com.br/toyota/toyota-faz-bem-carros-mas-e-pessima-em-mapas-e-central-multimidia_13230031/
   - Boletim técnico da Toyota (EUA, 2018) sobre unidades que mostram código de solicitação de 22 dígitos e não podiam ser atualizadas: https://static.nhtsa.gov/odi/tsbs/2018/MC-10129982-9999.pdf (mercado americano, pode não se aplicar)
4. Não está confirmado se o mapa é licenciado/amarrado ao rádio (SAM ID ou serial do cartão). É provável, mas não foi verificado.

## Opções avaliadas (da mais segura para a mais arriscada)
1. **Buscar o cartão pelo balcão de peças da concessionária.** Consultar se a peça 86271-02032 foi substituída por um número mais novo, e o preço e o prazo. O "serviço de atualização" pode ter sido descontinuado, mas o cartão pode existir como peça.
2. **Comprar um cartão novo em marketplaces.** Procurar `86271-02032` ou o sucessor, e confirmar compatibilidade com o hardware 86100-02260. Cuidado com vendedores de origem desconhecida.
3. **Trocar o rádio por uma central aftermarket** (CarPlay/Android Auto, moldura e chicote específicos do Corolla 2018). É a solução mais duradoura. Alternativa mais barata: usar o celular em suporte para navegação.
4. **Mapas de terceiros no cartão SD.** Arriscado: provável proteção de licença, risco de arquivos piratas ou incompatíveis. Não foi dado apoio a contornar proteções nem a usar mapas piratas.
5. **Hackear firmware, serial/UART ou CAN.** Desaconselhado: muito risco e pouco ganho. Não mexer no barramento CAN do carro.

## Próximos passos sugeridos
- [ ] **Fazer a imagem de backup do cartão atual** (carro desligado, retirar o cartão, usar leitor microSD, NÃO formatar). Ver comandos abaixo.
- [ ] Ligar para o balcão de **peças** da concessionária e perguntar pela peça 86271-02032 (substituição, preço, prazo).
- [ ] Pesquisar `86271-02032` em marketplaces e confirmar compatibilidade com o hardware 86100-02260.
- [ ] Se não houver cartão novo, avaliar a troca do rádio por uma central aftermarket.

## Backup do cartão (somente leitura), Linux ou macOS
Substitua `/dev/sdX` pelo dispositivo do cartão (confirme com `lsblk` no Linux ou `diskutil list` no macOS). Um dispositivo errado pode apagar dados.

```bash
# Linux: identificar o dispositivo
lsblk

# Gerar a imagem (leitura apenas do cartão)
sudo dd if=/dev/sdX of=mapa-corolla-86271-02032.img bs=4M status=progress conv=fsync

# Conferir integridade
sha256sum mapa-corolla-86271-02032.img > mapa-corolla-86271-02032.img.sha256
```

Depois do backup, guarde o cartão original em local seguro. Se algo der errado, a imagem permite restaurar em outro cartão do mesmo tamanho ou maior.

## Prompt sugerido para continuar no Claude Code
> Estou atualizando o mapa do multimídia do meu Corolla 2018 (hardware 86100-02260, ID 13TDANLA-EA00, SAM ID AEAIDFAKGU, mapa 1.4.A4, cartão Toyota microSDHC 86271-02032). A concessionária disse que não atualiza mais. Leia `relatorio-multimidia-corolla.md` e me ajude a: (1) fazer a imagem de backup do cartão com segurança, (2) analisar a estrutura de arquivos do cartão (só leitura) para entender como o mapa é armazenado, (3) redigir a mensagem para o balcão de peças da concessionária e (4) comparar centrais aftermarket compatíveis com o Corolla 2018. Não ajude a contornar proteções de licença nem a usar mapas piratas.

## Limitações conhecidas
- A análise do sistema operacional do rádio (Linux, QNX ou outro) é desconhecida; não foi confirmada.
- Os resultados de busca acima foram obtidos automaticamente e devem ser conferidos antes de decidir compras.
